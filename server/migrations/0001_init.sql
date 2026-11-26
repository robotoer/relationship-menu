-- Supporter sync schema. See docs/spec/sync.md §7 and §8.
-- The server stores no email, name or menu text: only opaque ids, Stripe ids,
-- status, dates, sizes and ciphertext (SY-22, SY-63).

CREATE TABLE accounts (
  account_id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('active', 'past_due', 'lifetime', 'lapsed')),
  plan TEXT,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  -- When the current paid period ends (ms since epoch), for yearly plans.
  paid_through INTEGER,
  -- When the account became read-only (ms); the purge happens 12 months later (SY-67).
  lapsed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  -- Change counter: every accepted write takes the next value (drives ?since=).
  seq INTEGER NOT NULL DEFAULT 0,
  -- Highest seq of a tombstone the cron has forgotten; older cursors must resync.
  purged_seq INTEGER NOT NULL DEFAULT 0
) STRICT;

CREATE INDEX accounts_by_customer ON accounts (stripe_customer_id);
CREATE INDEX accounts_by_subscription ON accounts (stripe_subscription_id);
CREATE INDEX accounts_by_lapse ON accounts (status, lapsed_at);

CREATE TABLE menus (
  account_id TEXT NOT NULL REFERENCES accounts (account_id) ON DELETE CASCADE,
  menu_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),
  size INTEGER NOT NULL,
  -- 12-byte nonce followed by the AES-GCM ciphertext; never readable here.
  ciphertext BLOB NOT NULL,
  PRIMARY KEY (account_id, menu_id)
) STRICT;

CREATE INDEX menus_by_seq ON menus (account_id, seq);
CREATE INDEX menus_tombstones ON menus (deleted, updated_at);

-- Stripe webhook event ids already handled (SY-62), kept for 30 days.
CREATE TABLE stripe_events (
  event_id TEXT PRIMARY KEY,
  received_at INTEGER NOT NULL
) STRICT;

-- One-time pairing blobs (SY-10): the sync code encrypted with a key only the
-- QR code holds. Cleared on first read; rows are deleted by the daily cron.
CREATE TABLE pairings (
  id TEXT PRIMARY KEY,
  blob BLOB,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
) STRICT;
