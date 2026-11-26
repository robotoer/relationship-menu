# The Wants & Won'ts Worker

One Cloudflare Worker serves the whole site: the built app as static files, and, under `/v1/`, the API for supporters' end-to-end encrypted sync and Stripe billing, with a D1 database. Its rules are in [`docs/spec/sync.md`](../docs/spec/sync.md) (§7 for the API, §8 for payments, §12 for hosting) and, for live sharing, [`docs/spec/notifications.md`](../docs/spec/notifications.md) (§7a), and each test names the rule it checks.

Static files never run Worker code: Cloudflare's asset router serves them, and any other path that isn't `/v1/*` gets the app's `index.html` (`[assets]` in `wrangler.toml`, HO-1). So the app costs nothing in Worker requests, and the API is on the app's own address, with no CORS (HO-2).

The server never sees menu text: it stores opaque ciphertext, ids, versions and sizes. It holds no credentials either: requests are signed with an Ed25519 key derived from the sync code, and the account id is a hash of that key.

## Run it

```bash
yarn build       # at the repository root: the app, into ../build, which the Worker serves
cd server
yarn install
yarn test        # Vitest inside the Workers runtime (Miniflare, local D1), then the
                 # routing tests (test-node/), which run wrangler.toml through Wrangler
yarn typecheck
yarn dev         # wrangler dev on :8787: the built app and the API, local D1
```

While working on the app, run `yarn start` at the root as usual: the Vite dev server passes `/v1` on to `yarn dev` here (HO-2).

The tests double as the reference client. `test/helpers.ts` → `Device` signs requests exactly as the app must.

## Wire protocol

```
Authorization: MenuSync v1 account=<id>, key=<pubkey>, ts=<unix seconds>, sig=<signature>
```

- **`key`:** the device's Ed25519 public key, 32 bytes, in base64url.
- **`account`:** base64url of the first 16 bytes of `SHA-256(key)`. That makes it 22 characters long.
- **`sig`:** Ed25519 over these five lines, joined by `\n`:
  ```
  menu-sync/v1
  <METHOD>
  <path and query, exactly as sent>
  <ts>
  <base64url(SHA-256(body))>
  ```
- **`ts`:** must be within ±300 s of the server's clock.

| Method and path | Body | Success | Errors |
| --- | --- | --- | --- |
| `GET /v1/health` | | `200 ok` | |
| `GET /v1/account` | | `{status, plan, renewsAt, readOnly, lapsedAt, purgeAt, purgeSoon, limits, usage}`; `status` is `none` for an unknown account | 401 |
| `DELETE /v1/account` | | 204 | 502 if Stripe can't cancel (nothing is deleted) |
| `POST /v1/account/rotate` | `{key, proof}`, where `proof` is the new key's signature over `menu-sync/v1\nrotate\n<old id>\n<new id>\n<ts>` | `{accountId}` | 401, 402, 409, 503 `rotation_too_slow` (it commits within 60 s of arriving, or not at all) |
| `GET /v1/menus?since=<seq>[&full=1]` | | `{menus:[{id, version, seq, deleted, updatedAt, ciphertext}], next, more, resync, purged}` | 402 |
| `PUT /v1/menus/:id` | ciphertext ≤ 64 KiB, with `If-None-Match: *` (new) or `If-Match: "<version>"` | `{version, seq}` | 402 `not_supporter` / `read_only`, 412 `{current}`, 413, 428, 507 |
| `DELETE /v1/menus/:id` | encrypted tombstone ≤ 4 KiB, with `If-Match` | `{version, seq}` | as for PUT |
| `POST /v1/checkout` | `{plan}`: one of `supporter_{6,12,24}_yearly` or `supporter_30_lifetime` | `{url}` | 400, 409 `already_supporter` |
| `POST /v1/portal` | | `{url}` | 402 |
| `POST /v1/pair` | `{id, blob}` (blob ≤ 1 KiB) | `201 {expiresAt}` | 402, 409, 413 |
| `GET /v1/pair/:id` | *(unsigned)* | `{blob}`, once | 404, 410 `used` / `expired` |
| `POST /v1/coach` | `{people, topics:[{id, group, item, kind, answers}]}` ≤ 16 KiB ([coach.md](../docs/spec/coach.md)) | `{opening, topics:[{id, about, questions}], closing}` | 400, 402 `not_supporter` / `read_only`, 422 `coach_declined`, 429 `coach_quota`, 502 `coach_failed`, 503 `coach_unavailable` / `coach_busy` |
| `POST /v1/stripe/webhook` | *(Stripe-signed)* | `{received}` | 400 `bad_signature` |

- Errors are JSON: `{"error": "<code>"}`.
- Rate limits answer 429 with `Retry-After`.
- `resync: true` means the device's cursor is older than a forgotten tombstone. The device should pull from `since=0` and treat synced menus that are now missing as deleted.
- `purged` is the account's newest forgotten tombstone (`purged_seq`). The later pages of a listing that started from 0 send `full=1`, so they aren't told to resync again; if `purged` changes part-way, the device starts the listing over.

### Live-sharing boxes

A box holds one conversation shared live ([`notifications.md`](../docs/spec/notifications.md) §2, §3 and the wire protocol in §7a): one encrypted copy of the conversation per member device. The server never sees the box key K or the join secret J, only `SHA-256(J)`. [`src/boxes.ts`](src/boxes.ts) implements it, and `BoxDevice` in [`test/helpers.ts`](test/helpers.ts) signs requests the way the app must.

Member requests are signed like sync requests, with the device's own box key (not the sync code) and their own label:

```
Authorization: MenuBox v1 box=<box id>, key=<pubkey>, ts=<unix seconds>, sig=<signature>
```

- **`key`:** the device's Ed25519 box public key, 32 bytes, base64url. Its member id is base64url of the first 16 bytes of `SHA-256(key)`.
- **`box`:** must be the box in the path.
- **`sig`:** Ed25519 over `menu-box/v1`, METHOD, path and query, ts and `base64url(SHA-256(body))`, joined by `\n`.
- **`ts`:** within ±300 s.

A bad or mismatched header gets 401 (`clock_skew` for the time). Then an unknown box gets 404 `not_found` (also after Stop sharing), and a key that isn't a member gets 403 `not_member`. Ids that aren't 22-character base64url get 400 `bad_request`.

| Method and path | Auth | Body | Success | Errors |
| --- | --- | --- | --- | --- |
| `POST /v1/boxes` | `MenuSync` (5/min per account) | `{boxId, joinHash, hostKey}`: `joinHash` = base64url(SHA-256(J)), `hostKey` = the host device's box key | `201 {boxId, memberId, inviteExpiresAt}` | 400, 402 `not_supporter` / `read_only`, 409 `box_exists`, 429 `too_many_boxes` (50 per account) |
| `POST /v1/boxes/:id/members` | none (10/min per IP) | `{key, join}`: the device's box key, and J in base64url | `201 {memberId}`, also when already a member | 400, 404, 403 `bad_join`, 410 `invite_expired` (7 days, or cleared by the cron), 409 `box_full` (16 members) |
| `POST /v1/boxes/:id/invite` | host | `{joinHash}` | `{inviteExpiresAt}`: 7 days from now; the old J stops working | 403 `not_host`, 402 `read_only` |
| `GET /v1/boxes/:id/copies?since=<seq>` | member | | `{copies:[{memberId, version, seq, updatedAt, ciphertext}], seq, readOnly, members}`: the copies written after `since` (all for 0), oldest first | 400 |
| `PUT /v1/boxes/:id/copies/:memberId` | that member | ciphertext, 28 B to 256 KiB, with `If-None-Match: *` (first copy) or `If-Match: "<version>"`; `Notify` is accepted and ignored for now | `{version, seq}` | 400, 402 `read_only`, 403 `not_yours`, 412 `version_mismatch {current: {version}}` (`current: null` if there's no copy yet), 413, 428 |
| `DELETE /v1/boxes/:id/members/me` | member | | 204, and its copy goes too | 409 `host_must_stop` |
| `DELETE /v1/boxes/:id` | host | | 204: every copy and member goes | 403 `not_host` |

- Member requests count against the general per-account limit, keyed per box and member device (60/min deployed).
- `readOnly` is true once the host's account has lapsed (or is gone): members can still read, leave and stop, but writes and new invites get 402 `read_only` (NT-16).
- Deleting the host's account, or the daily purge of an account lapsed 12 months, deletes its boxes. Replacing the sync code (`/v1/account/rotate`) moves them to the new account. The daily cron also clears expired join hashes.
- Copies aren't counted in the menus quota.

### Keys, records and pairing blobs

The server never reads these, but every device has to agree on them byte for byte. They're implemented in [`src/sync/`](../src/sync/), and [`src/sync/test-vectors.ts`](../src/sync/test-vectors.ts) pins them. Those vectors never change: changing a label or a layout would lock everyone out of their synced menus. [`test/client-vectors.test.ts`](test/client-vectors.test.ts) checks the app's signed headers with this server's `authenticate()`.

**Keys** ([`keys.ts`](../src/sync/keys.ts)). The sync code is 32 random bytes, shown as 24 BIP-39 English words. From it, HKDF-SHA-256 with salt `menu-sync/v1` derives:
- with info `sign`: a 32-byte Ed25519 seed. It's imported as PKCS#8, `302e020100300506032b657004220420` ‖ seed. The public key is the `x` of its JWK, and the account id is computed from it as above.
- with info `encrypt`: the AES-256-GCM key for records.

**Records** ([`records.ts`](../src/sync/records.ts)): the body of `PUT` and `DELETE /v1/menus/:id`.

```
record = nonce (12 random bytes) ‖ AES-256-GCM(padded plaintext) ‖ tag (16 bytes)
```

The additional data is 65 bytes. It is authenticated but not sent:

| Offset | Size | Field |
| --- | --- | --- |
| 0 | 12 | `menu-sync/v1` (ASCII) |
| 12 | 22 | account id (ASCII) |
| 34 | 22 | menu id (ASCII) |
| 56 | 8 | version, unsigned big-endian: the version this write gets (1 for `If-None-Match: *`, otherwise the `If-Match` version + 1) |
| 64 | 1 | `0x01` for a tombstone, `0x00` for a live menu |

So a record that's moved to another account or menu, served as another version, or has its `deleted` flag flipped fails to decrypt.

The padded plaintext is a 4-byte unsigned big-endian length *n*, then *n* bytes of UTF-8 JSON, then zeros. It's padded to the next multiple of 1024 bytes, and is at least 1024. The JSON is `{"v":1, "id", "title", "encoded", "person"?, "createdAt"?, "updatedAt"?, "editId", "deviceId"?, "deleted"?}`, in that order. `updatedAt` is the edit time and `deviceId` is the writing device's id: a conflict goes to the later edit time, then the device id (SY-35). A tombstone has `"deleted": true`, an empty title and an empty `encoded`.

So every record is a whole number of KiB plus 28 bytes: 1,052 bytes for a tombstone or a small menu. The largest padded plaintext is 63 KiB for a menu and 3 KiB for a tombstone, so records stay within the 64 KiB and 4 KiB limits.

**Pairing blobs** ([`pairing.ts`](../src/sync/pairing.ts)). The first device picks a random 32-byte key K and sends:
- `id` = base64url(first 16 bytes of SHA-256(K));
- `blob` = nonce (12 random bytes) ‖ AES-256-GCM_K(the 32-byte sync secret, additional data `menu-sync/v1\npair`), 60 bytes in all.

The QR code holds `/pair#<base64url(K)>`. Since K is in the fragment, the server never receives it.

## Environments and secrets

| Environment | Worker | D1 | Stripe |
| --- | --- | --- | --- |
| *(local)* | `wantsandwonts-local` | Miniflare | stubbed in tests |
| `test` | `wantsandwonts-test` on workers.dev | `menu-sync-test` | test mode (sandbox) |
| `production` | `wantsandwonts` on wantsandwonts.com | `menu-sync-prod` | live, once launched |

Secrets never go in the repository or in chat. Paste each one at Wrangler's prompt:

```bash
npx wrangler secret put STRIPE_SECRET_KEY --env test
```

```bash
npx wrangler secret put STRIPE_WEBHOOK_SECRET --env test
```

**`STRIPE_SECRET_KEY`** is a Stripe *restricted* key. Create it under Developers → API keys → Create restricted key, with these permissions:
- Prices: Read
- Checkout Sessions: Write
- Customer portal: Write
- Subscriptions: Write

Leave everything else at None.

**`STRIPE_WEBHOOK_SECRET`** is the endpoint's signing secret (`whsec_…`). Create the endpoint under Developers → Webhooks → Add endpoint:
- URL: `https://wantsandwonts-test.<your-subdomain>.workers.dev/v1/stripe/webhook`
- API version: `2025-03-31.basil`
- Events:
  - `checkout.session.completed`
  - `checkout.session.async_payment_succeeded`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.payment_failed`

**Deploys:** `.github/workflows/server.yml` builds the app and tests the Worker on every push and pull request (HO-10).
- Each pull request from this repository gets a preview URL, `pr-<number>-wantsandwonts-test.<subdomain>.workers.dev`: a new version of the test Worker, sharing its database, that doesn't replace what's deployed.
- On `main` it applies D1 migrations and deploys the `test` environment.
- On `main`, once the repository variable `DEPLOY_PRODUCTION` is `true` (Settings → Secrets and variables → Actions → Variables), it also deploys `production`.

All of these need the GitHub Actions secrets `CLOUDFLARE_API_TOKEN` (Workers Scripts: Edit, D1: Edit, scoped to your account) and `CLOUDFLARE_ACCOUNT_ID`. Without them, the preview and test deploys skip with a warning.

**The production address:** `wantsandwonts.com` is a Workers custom domain, set by `routes` under `[env.production]` in `wrangler.toml`; Cloudflare manages its DNS record and certificate. `wantsandwonts.app` and `www.wantsandwonts.com` redirect to it with Cloudflare redirect rules in the dashboard.
