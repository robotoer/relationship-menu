# Supporter sync server

A Cloudflare Worker with a D1 database, for supporters' end-to-end encrypted sync and for Stripe billing. Its rules are in [`docs/spec/sync.md`](../docs/spec/sync.md) (§7 for the API, §8 for payments), and each test names the rule it checks.

The server never sees menu text: it stores opaque ciphertext, ids, versions and sizes. It holds no credentials either: requests are signed with an Ed25519 key derived from the sync code, and the account id is a hash of that key.

## Run it

```bash
cd server
yarn install
yarn test        # Vitest inside the Workers runtime (Miniflare, local D1)
yarn typecheck
yarn dev         # wrangler dev, test environment settings, local D1
```

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
| `POST /v1/account/rotate` | `{key, proof}`, where `proof` is the new key's signature over `menu-sync/v1\nrotate\n<old id>\n<new id>\n<ts>` | `{accountId}` | 401, 402, 409 |
| `GET /v1/menus?since=<seq>` | | `{menus:[{id, version, seq, deleted, updatedAt, ciphertext}], next, more, resync}` | 402 |
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

The padded plaintext is a 4-byte unsigned big-endian length *n*, then *n* bytes of UTF-8 JSON, then zeros. It's padded to the next multiple of 1024 bytes, and is at least 1024. The JSON is `{"v":1, "id", "title", "encoded", "person"?, "createdAt"?, "updatedAt"?, "editId", "deleted"?}`, in that order. A tombstone has `"deleted": true`, an empty title and an empty `encoded`.

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
| `production` | `wantsandwonts` | `menu-sync-prod` | live, once launched |

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

**Deploys:** `.github/workflows/server.yml` tests every change to `server/`. On `main` it applies D1 migrations and deploys the `test` environment. That needs the GitHub Actions secrets `CLOUDFLARE_API_TOKEN` (Workers Scripts: Edit, D1: Edit, scoped to your account) and `CLOUDFLARE_ACCOUNT_ID`. Without them, the deploy job skips with a warning.
