/** The daily clean-up (SY-45, SY-67). Deletes only what the rules say has expired. */

import { DAY_MS, PURGE_AFTER_MS, TOMBSTONE_TTL_MS, type Env } from "./env";
import { log } from "./log";

export const runDailyPurge = async (env: Env, nowMs = Date.now()) => {
  const lapsedBefore = nowMs - PURGE_AFTER_MS;
  const tombstonesBefore = nowMs - TOMBSTONE_TTL_MS;
  const results = await env.DB.batch([
    // SY-67: accounts lapsed for more than 12 months lose their synced data.
    env.DB.prepare(
      "DELETE FROM menus WHERE account_id IN (SELECT account_id FROM accounts WHERE status = 'lapsed' AND lapsed_at < ?)"
    ).bind(lapsedBefore),
    env.DB.prepare("DELETE FROM accounts WHERE status = 'lapsed' AND lapsed_at < ?").bind(lapsedBefore),
    // SY-23: forget tombstones after 180 days; remember the newest forgotten seq so
    // devices with an older cursor know to resync.
    env.DB.prepare(
      `UPDATE accounts SET purged_seq = MAX(purged_seq,
         (SELECT MAX(seq) FROM menus m WHERE m.account_id = accounts.account_id AND m.deleted = 1 AND m.updated_at < ?1))
       WHERE EXISTS (SELECT 1 FROM menus m WHERE m.account_id = accounts.account_id AND m.deleted = 1 AND m.updated_at < ?1)`
    ).bind(tombstonesBefore),
    env.DB.prepare("DELETE FROM menus WHERE deleted = 1 AND updated_at < ?").bind(tombstonesBefore),
    // SY-45: pairing rows a day after expiry (kept that long to say "already used").
    env.DB.prepare("DELETE FROM pairings WHERE expires_at < ?").bind(nowMs - DAY_MS),
    // SY-62: webhook event ids after 30 days.
    env.DB.prepare("DELETE FROM stripe_events WHERE received_at < ?").bind(nowMs - 30 * DAY_MS),
  ]);
  const counts = {
    purgedMenus: results[0]?.meta.changes ?? 0,
    purgedAccounts: results[1]?.meta.changes ?? 0,
    tombstones: results[3]?.meta.changes ?? 0,
    pairings: results[4]?.meta.changes ?? 0,
    events: results[5]?.meta.changes ?? 0,
  };
  log({ route: "cron daily", status: 200, code: "purged", ...counts });
  return counts;
};
