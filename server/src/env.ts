/** Bindings and settings the Worker runs with (wrangler.toml + secrets). */
export interface Env {
  DB: D1Database;
  /** The app's origin, for Stripe's return URLs (e.g. https://wantsandwonts.com). */
  APP_ORIGIN: string;
  /** "true" to sell through Stripe Managed Payments (merchant of record). */
  MANAGED_PAYMENTS?: string;
  /** Stripe restricted key (secret). */
  STRIPE_SECRET_KEY?: string;
  /** Stripe webhook signing secret, whsec_… (secret). */
  STRIPE_WEBHOOK_SECRET?: string;
  /** Rate limiters (SY-43). Optional so the Worker still runs where they're unavailable. */
  RL_ACCOUNT?: RateLimit;
  RL_SENSITIVE?: RateLimit;
  RL_IP?: RateLimit;
}

/** Quotas per account (SY-23). */
export const LIMITS = {
  menus: 500,
  menuBytes: 64 * 1024,
  totalBytes: 4 * 1024 * 1024,
  tombstoneBytes: 4 * 1024,
  jsonBytes: 4 * 1024,
  pairingBlobBytes: 1024,
} as const;

export const DAY_MS = 24 * 60 * 60 * 1000;

/** How long after lapsing an account's synced data is kept (SY-67). */
export const PURGE_AFTER_MS = 365 * DAY_MS;
/** In-app warning period before the purge (SY-67). */
export const PURGE_WARNING_MS = 30 * DAY_MS;
/** How long deletion tombstones are kept (SY-23). */
export const TOMBSTONE_TTL_MS = 180 * DAY_MS;
/** How long pairing blobs live (SY-10). */
export const PAIRING_TTL_MS = 10 * 60 * 1000;
