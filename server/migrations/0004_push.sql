-- Web push subscriptions (docs/spec/notifications.md §4, §7b; NT-20…NT-28,
-- NT-55, NT-56). One row per subscribed browser per member device per box. The
-- server holds the browser's push endpoint and its public encryption keys, and
-- the counters that keep notifications rare (NT-24): never any conversation text.
--
-- There's no foreign key to box_members on purpose: leaving, Stop sharing and
-- account deletion delete a device's subscriptions explicitly, and the daily
-- cron deletes any whose member or box no longer exists (NT-56).

CREATE TABLE push_subs (
  sub_id TEXT PRIMARY KEY,
  box_id TEXT NOT NULL,
  -- The member device that subscribed (it's told about the others' writes).
  member_id TEXT NOT NULL,
  -- The PushSubscription's endpoint: https, on a known push service (NT-55).
  endpoint TEXT NOT NULL,
  -- The browser's P-256 public key (65 bytes) and auth secret (16 bytes), base64url (RFC 8291).
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  -- When the last notification went out (ms), or NULL if none has yet.
  last_sent_at INTEGER,
  -- Changes held back by the 15-minute window or the daily limit (NT-24):
  -- how many, and 'comment' if any of them was a comment, else 'notes'.
  pending_kind TEXT CHECK (pending_kind IN ('comment', 'notes')),
  pending_count INTEGER NOT NULL DEFAULT 0,
  -- The UTC day (YYYY-MM-DD) that sent_today counts.
  day TEXT,
  sent_today INTEGER NOT NULL DEFAULT 0,
  UNIQUE (box_id, member_id, endpoint)
) STRICT;

CREATE INDEX push_subs_by_box ON push_subs (box_id);
-- The 5-minute cron looks only at subscriptions with something waiting.
CREATE INDEX push_subs_waiting ON push_subs (last_sent_at) WHERE pending_count > 0;
