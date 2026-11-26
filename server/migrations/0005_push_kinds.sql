-- Store-app push (docs/spec/notifications.md §6, §7c; NT-40…NT-42). The iOS and
-- Android apps register a Firebase Cloud Messaging token instead of a web push
-- subscription; both kinds share push_subs, its counters and its clean-up.
--
-- FCM rows keep the token in `endpoint` (1-4096 characters of [A-Za-z0-9_:-], so
-- it can never equal a web push URL), and p256dh and auth are empty. The unique
-- (box_id, member_id, endpoint) keeps re-registering the same token idempotent.

ALTER TABLE push_subs ADD COLUMN kind TEXT NOT NULL DEFAULT 'webpush' CHECK (kind IN ('webpush', 'fcm'));
ALTER TABLE push_subs ADD COLUMN platform TEXT CHECK (platform IS NULL OR platform IN ('android', 'ios'));
-- FCM rows keep the token in `endpoint`; p256dh and auth are empty.
