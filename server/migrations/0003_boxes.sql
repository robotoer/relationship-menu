-- Live-sharing boxes (docs/spec/notifications.md §2, §3, §7a). The server holds
-- only ciphertext, sizes, times, device public keys and the hash of each box's
-- join secret: never the box key, the join secret itself or any conversation text.

CREATE TABLE boxes (
  box_id TEXT PRIMARY KEY,
  -- The supporter account that shared it (NT-10). Its status decides whether the
  -- box can be written (NT-16); it moves on rotation and goes with the account.
  host_account TEXT NOT NULL,
  -- base64url(SHA-256(J)), or NULL once the invite has expired (NT-1, NT-13).
  join_hash TEXT,
  invite_expires_at INTEGER,
  -- Change counter: every accepted copy write takes the next value (drives ?since=).
  seq INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
) STRICT;

CREATE INDEX boxes_by_host ON boxes (host_account);
CREATE INDEX boxes_by_invite ON boxes (invite_expires_at);

CREATE TABLE box_members (
  box_id TEXT NOT NULL REFERENCES boxes (box_id) ON DELETE CASCADE,
  -- base64url(first 16 bytes of SHA-256(public_key)).
  member_id TEXT NOT NULL,
  -- The device's Ed25519 box key (32 bytes); requests are signed with it (NT-12).
  public_key BLOB NOT NULL,
  is_host INTEGER NOT NULL CHECK (is_host IN (0, 1)),
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (box_id, member_id)
) STRICT;

CREATE TABLE box_copies (
  box_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  size INTEGER NOT NULL,
  -- 12-byte nonce followed by the AES-GCM ciphertext; never readable here (NT-2).
  ciphertext BLOB NOT NULL,
  PRIMARY KEY (box_id, member_id),
  FOREIGN KEY (box_id, member_id) REFERENCES box_members (box_id, member_id) ON DELETE CASCADE
) STRICT;

CREATE INDEX box_copies_by_seq ON box_copies (box_id, seq);
