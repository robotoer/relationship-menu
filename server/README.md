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
| `POST /v1/stripe/webhook` | *(Stripe-signed)* | `{received}` | 400 `bad_signature` |

- Errors are JSON: `{"error": "<code>"}`.
- Rate limits answer 429 with `Retry-After`.
- `resync: true` means the device's cursor is older than a forgotten tombstone. The device should pull from `since=0` and treat synced menus that are now missing as deleted.

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
