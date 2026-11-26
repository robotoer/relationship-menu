# The Wants & Won'ts Worker

One Cloudflare Worker serves the whole site: the built app as static files, and, under `/v1/`, the API for supporters' end-to-end encrypted sync and Stripe billing, with a D1 database. Its rules are in [`docs/spec/sync.md`](../docs/spec/sync.md) (§7 for the API, §8 for payments, §12 for hosting) and, for live sharing and its notifications, [`docs/spec/notifications.md`](../docs/spec/notifications.md) (§7a, §7b), and each test names the rule it checks.

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
| `PUT /v1/boxes/:id/copies/:memberId` | that member | ciphertext, 28 B to 256 KiB, with `If-None-Match: *` (first copy) or `If-Match: "<version>"`, and `Notify: comment\|notes\|none` (see [Web push](#web-push)) | `{version, seq}` | 400, 402 `read_only`, 403 `not_yours`, 412 `version_mismatch {current: {version}}` (`current: null` if there's no copy yet), 413, 428 |
| `DELETE /v1/boxes/:id/members/me` | member | | 204, and its copy and push subscriptions go too | 409 `host_must_stop` |
| `DELETE /v1/boxes/:id` | host | | 204: every copy, member and push subscription goes | 403 `not_host` |

- Member requests count against the general per-account limit, keyed per box and member device (60/min deployed).
- `readOnly` is true once the host's account has lapsed (or is gone): members can still read, leave and stop, but writes and new invites get 402 `read_only` (NT-16).
- Deleting the host's account, or the daily purge of an account lapsed 12 months, deletes its boxes. Replacing the sync code (`/v1/account/rotate`) moves them to the new account. The daily cron also clears expired join hashes.
- Copies aren't counted in the menus quota.

### Web push

Members' devices can ask to be told when another member writes ([`notifications.md`](../docs/spec/notifications.md) §4 and §7b). [`src/notify.ts`](src/notify.ts) has the routes and the sending, [`src/push.ts`](src/push.ts) decides *when* (a pure state machine), and [`src/webpush.ts`](src/webpush.ts) does RFC 8291 encryption and RFC 8292 VAPID with WebCrypto alone. In the tests, `PushBrowser` and `fakePushService` ([`test/helpers.ts`](test/helpers.ts)) play the browser and the push service, decrypting every push.

| Method and path | Auth | Body | Success | Errors |
| --- | --- | --- | --- | --- |
| `GET /v1/push/key` | none | | `{key}`: the VAPID public key (base64url, 65-byte uncompressed P-256), for `pushManager.subscribe` | 503 `push_unavailable` |
| `POST /v1/boxes/:id/subscriptions` | member | `{endpoint, p256dh, auth}` from the browser's `PushSubscription` (keys base64url: 65 bytes starting `0x04`, and 16 bytes) | `201 {subId}`; the same endpoint for the same member device returns its existing `subId` (with the keys just sent) | 400 `bad_request`, 400 `bad_endpoint`, 409 `too_many_subscriptions` (5 per member device per box), 503 `push_unavailable` |
| `DELETE /v1/boxes/:id/subscriptions/:subId` | member, own subscription only | | 204 (works without VAPID keys too) | 400, 404 `not_found` |

- **Endpoints (NT-55):** `https` only, on the default port, no credentials, and the host must be one of `fcm.googleapis.com`, `push.services.mozilla.com`, `push.apple.com` or `notify.windows.com`, or end in `.` plus one of them (so `web.push.apple.com` is fine and `fcm.googleapis.com.evil.test` isn't). Pushes don't follow redirects. So a subscription can't make the Worker call anything else.
- **Who's told (NT-23):** a copy write with `Notify: comment` or `Notify: notes` (any case) is offered to every subscription of every *other* member device in the box. `none`, a missing header or anything else tells nobody, and so does a refused write (412, 402 read-only, …). The response never waits: the pushes run after it, in `ctx.waitUntil`.
- **How often (NT-24):** a subscription gets at most one push every 15 minutes and 20 per UTC day. A change that can't go now waits (`pending_count + 1`, `pending_kind` becomes `comment` if it is one); the next push carries `count` = everything waiting plus itself, and `kind` = `comment` if any was. A cron every 5 minutes sends whatever waits once the window and the day allow (at most 500 subscriptions per run, longest-waiting first). Each send is claimed in D1 with a compare-and-set first, so concurrent writes can't send twice in a window.
- **The push:** RFC 8030 `POST` with `TTL: 86400`, `Urgency: normal`, `Topic: <boxId>` (a push service keeps only the newest per box for an offline device), `Content-Encoding: aes128gcm` and `Authorization: vapid t=<ES256 JWT>, k=<public key>` (JWT `aud` = the endpoint's origin, `exp` = 12 hours, `sub` = `VAPID_SUBJECT`). The body is one RFC 8188 record (rs 4096) whose plaintext is exactly `{"box":"<boxId>","kind":"comment"|"notes","count":n}`.
- **The push service's answer (NT-28):** 2xx is done. 404 or 410 deletes the subscription. 429, 5xx or no answer undoes the attempt (the changes wait again, and the window and day count are as before), so the 5-minute cron retries. Any other answer (another 4xx, a redirect) is logged and the push dropped; the subscription stays.
- **Clean-up (NT-53, NT-56):** leaving, Stop sharing, account deletion and the daily purge of a host's boxes delete the affected subscriptions. The daily cron also deletes any whose box or member device is gone, any with changes undelivered for 60 days (the push service keeps failing), and clears past days' counters.
- **Logs (SY-44):** one line per failed push (`push_gone`, `push_retry`, `push_unreachable`, `push_failed`) with only route, status and code, and one count line per 5-minute cron that had something to do. Never an endpoint, key, id or payload.

### Store-app push (FCM)

The iOS and Android apps register a Firebase Cloud Messaging token instead of a web push subscription ([`notifications.md`](../docs/spec/notifications.md) §6 and §7c, NT-40…NT-42). Both platforms go through FCM HTTP v1 (iOS through FCM's APNs connection). [`src/fcm.ts`](src/fcm.ts) signs the OAuth assertion (RS256, WebCrypto alone) and builds and sends the message; [`src/notify.ts`](src/notify.ts) sends each subscription through its own channel with the same scheduling, claiming and retries as web push. In the tests, `makeServiceAccount` and `fakeGoogle` ([`test/helpers.ts`](test/helpers.ts)) make a service account with a fresh RSA key and play Google's token endpoint (checking every JWT's signature and claims) and `messages:send`.

| Method and path | Auth | Body | Success | Errors |
| --- | --- | --- | --- | --- |
| `POST /v1/boxes/:id/subscriptions` | member | `{"kind": "fcm", "token": "<FCM registration token>", "platform": "android"\|"ios"}`; the token is 1–4,096 characters of `[A-Za-z0-9_:-]` | `201 {subId}`; the same token for the same member device returns its existing `subId` (with the platform just sent) | 400 `bad_request`, 409 `too_many_subscriptions` (5 per member device per box, web push and FCM together), 503 `push_unavailable` (no or a malformed `FCM_SERVICE_ACCOUNT`) |
| `DELETE /v1/boxes/:id/subscriptions/:subId` | member, own subscription only | | 204, for both kinds | 400, 404 `not_found` |

- **Storage:** migration `0005_push_kinds.sql` adds `kind` (`webpush` or `fcm`, default `webpush`) and `platform` to `push_subs`. FCM rows keep the token in `endpoint`, with empty `p256dh` and `auth`.
- **Per kind:** web push needs the VAPID secrets and FCM needs `FCM_SERVICE_ACCOUNT`; each kind answers 503 on its own. If a kind's credentials go missing later, its subscriptions are left alone: a write's change waits on them, and the 5-minute cron sends it once the credentials are back. (With neither configured, push is off and writes record nothing, as before.)
- **Auth:** an RS256 JWT with `iss` = the service account's `client_email`, `scope` = `https://www.googleapis.com/auth/firebase.messaging`, `aud` = `https://oauth2.googleapis.com/token`, valid 1 hour, exchanged at that address for an access token. The token is cached in the isolate until a minute before it expires, so a round of sends costs one token request at most.
- **What's sent:** `POST https://fcm.googleapis.com/v1/projects/<project_id>/messages:send` with `Authorization: Bearer <access token>`:
  ```json
  { "message": {
      "token": "<token>",
      "notification": { "title": "Wants & Won'ts", "body": "Something new in a conversation." },
      "data": { "box": "<boxId>", "kind": "comment|notes", "count": "<n>" },
      "android": { "collapse_key": "<boxId>", "priority": "normal", "ttl": "86400s", "notification": { "tag": "box-<boxId>" } },
      "apns": { "headers": { "apns-collapse-id": "<boxId>", "apns-priority": "5", "apns-expiration": "<now + 1 day, Unix seconds>" },
                "payload": { "aps": { "thread-id": "<boxId>" } } } } }
  ```
  With `count > 1` the body is "N new changes in a conversation.". The text is fixed, so the lock screen shows no names or topics. FCM's payload isn't end-to-end encrypted: it holds the box id and counts, nothing else. Only those two Google addresses are ever called for FCM, and redirects aren't followed.
- **FCM's answer:** 200 is done. 404, or 400 with `UNREGISTERED`, or `INVALID_ARGUMENT` about the token (a `message.token` field violation, or an error message about the registration token) deletes the subscription. 429, 5xx or no answer waits for the cron, as for web push. 401 or 403 also waits, logged as `push_auth` (a 401 also drops the cached access token), so a broken service account doesn't lose anyone's subscription. Any other answer (another 4xx, including an `INVALID_ARGUMENT` about something else, or a redirect) is logged and the push dropped; the subscription stays. If no access token can be had, every FCM send of that round waits, logged once (route `push fcm token`).
- **Clean-up and logs:** as for web push. FCM lines use the route `push fcm`; never a token, project id, account email, key, access token or id.

**Crons** (`[env.*.triggers]` in `wrangler.toml`; `scheduled` in `src/index.ts` picks the job by `controller.cron`): `17 3 * * *` is the daily purge ([`src/cron.ts`](src/cron.ts)) and `*/5 * * * *` flushes waiting notifications. Locally, try them with `wrangler dev --test-scheduled` and `curl "http://localhost:8787/__scheduled?cron=*/5+*+*+*+*"`.

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

**Web push** needs three secrets; without them `GET /v1/push/key` and subscribing answer 503 `push_unavailable`, nothing is sent, and everything else works (NT-54):
- **`VAPID_PUBLIC_KEY`:** base64url of the 65-byte uncompressed P-256 public key.
- **`VAPID_PRIVATE_KEY`:** base64url of the 32-byte private scalar `d`.
- **`VAPID_SUBJECT`:** a project contact for the push services, `mailto:` or `https:`, never a person's own address.

Make a key pair (Node 20 or later) and paste each value at `wrangler secret put`'s prompt. Use a separate pair per environment, and don't replace one casually: browsers subscribed with the old public key stop getting pushes until the app subscribes them again.

```bash
node -e 'crypto.subtle.generateKey({name:"ECDSA",namedCurve:"P-256"},true,["sign"]).then(async k=>{const j=await crypto.subtle.exportKey("jwk",k.privateKey);const b=s=>Buffer.from(s,"base64url");console.log("VAPID_PUBLIC_KEY="+Buffer.concat([Buffer.from([4]),b(j.x),b(j.y)]).toString("base64url"));console.log("VAPID_PRIVATE_KEY="+j.d)})'
```

```bash
npx wrangler secret put VAPID_PUBLIC_KEY --env test
npx wrangler secret put VAPID_PRIVATE_KEY --env test
npx wrangler secret put VAPID_SUBJECT --env test
```

**Store-app push** needs one secret, **`FCM_SERVICE_ACCOUNT`**: a Google service account's JSON key (it holds `project_id`, `client_email` and `private_key`). Without it, or if it's malformed, FCM subscriptions answer 503 `push_unavailable` and web push and everything else work.

1. In the [Firebase console](https://console.firebase.google.com/), add a project (or add Firebase to an existing Google Cloud project), and register the Android app and the iOS app in it. For iOS, upload the APNs authentication key (`.p8`) under Project settings → Cloud Messaging, so FCM can deliver through APNs. The apps' `google-services.json` and `GoogleService-Info.plist` come from here too; they belong to the app repository, not this one.
2. Make the key. Either Project settings → Service accounts → **Generate new private key** (the Firebase Admin SDK service account), or, with less access, in the Google Cloud console under IAM & Admin → Service accounts: create a service account for this Worker, give it only the **Firebase Cloud Messaging API Admin** role (`roles/firebasecloudmessaging.admin`), then Keys → Add key → JSON. Check that the **Firebase Cloud Messaging API** (V1) is enabled under APIs & Services.
3. Store the whole file as the secret, straight from the file (it never needs to be pasted anywhere), then delete the local copy:

```bash
npx wrangler secret put FCM_SERVICE_ACCOUNT --env test < key.json
rm key.json
```

Use a separate key (ideally a separate Firebase project) per environment. To rotate, add a new key, put the secret again, then delete the old key in the console; the Worker picks up the new one on its next request.

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

**`OPENROUTER_API_KEY`** is only for the AI coach, which also needs `COACH_ENABLED = "true"` in the environment's vars. It's an [OpenRouter](https://openrouter.ai) API key; give it a monthly credit limit. See [`docs/spec/coach.md`](../docs/spec/coach.md) ("Before switching it on").

**Deploys:** `.github/workflows/server.yml` builds the app and tests the Worker on every push and pull request (HO-10).
- Each pull request from this repository gets a preview URL, `pr-<number>-wantsandwonts-test.<subdomain>.workers.dev`: a new version of the test Worker, sharing its database, that doesn't replace what's deployed.
- On `main` it applies D1 migrations and deploys the `test` environment.
- On `main`, once the repository variable `DEPLOY_PRODUCTION` is `true` (Settings → Secrets and variables → Actions → Variables), it also deploys `production`.

All of these need the GitHub Actions secrets `CLOUDFLARE_API_TOKEN` (Workers Scripts: Edit, D1: Edit, scoped to your account) and `CLOUDFLARE_ACCOUNT_ID`. Without them, the preview and test deploys skip with a warning.

**The production address:** `wantsandwonts.com` is a Workers custom domain, set by `routes` under `[env.production]` in `wrangler.toml`; Cloudflare manages its DNS record and certificate. `wantsandwonts.app` and `www.wantsandwonts.com` redirect to it with Cloudflare redirect rules in the dashboard.
