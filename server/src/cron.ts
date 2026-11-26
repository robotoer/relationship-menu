/**
 * The crons (wrangler.toml): the daily clean-up (SY-45, SY-67, NT-53, NT-56),
 * which deletes only what the rules say has expired, and every 5 minutes the
 * flush of held-back notifications (NT-24, notify.ts).
 */

import { deleteBoxesWhere } from "./boxes";
import { DAY_MS, PURGE_AFTER_MS, PUSH_UNDELIVERED_TTL_MS, TOMBSTONE_TTL_MS, type Env } from "./env";
import { log } from "./log";
import { flushPending } from "./notify";
import { PUSH_CRON, utcDay } from "./push";

/** Runs the job for a cron trigger: the 5-minute push flush, or else the daily purge. */
export const runCron = (env: Env, cron: string, scheduledTime: number) =>
  cron === PUSH_CRON ? flushPending(env, scheduledTime) : runDailyPurge(env);

export const runDailyPurge = async (env: Env, nowMs = Date.now()) => {
  const lapsedBefore = nowMs - PURGE_AFTER_MS;
  const tombstonesBefore = nowMs - TOMBSTONE_TTL_MS;
  const results = await env.DB.batch([
    // SY-67: accounts lapsed for more than 12 months lose their synced data.
    env.DB.prepare(
      "DELETE FROM menus WHERE account_id IN (SELECT account_id FROM accounts WHERE status = 'lapsed' AND lapsed_at < ?)"
    ).bind(lapsedBefore),
    env.DB.prepare("DELETE FROM accounts WHERE status = 'lapsed' AND lapsed_at < ?").bind(lapsedBefore),
    // NT-16, NT-53: boxes go with their host's account (here: any box whose host
    // account no longer exists), with every member and copy.
    ...deleteBoxesWhere(env.DB, "NOT EXISTS (SELECT 1 FROM accounts a WHERE a.account_id = boxes.host_account)"),
    // NT-56: subscriptions whose member device (or box) is gone, however it went.
    env.DB.prepare(
      `DELETE FROM push_subs WHERE NOT EXISTS (SELECT 1 FROM boxes b WHERE b.box_id = push_subs.box_id)
         OR NOT EXISTS (SELECT 1 FROM box_members m WHERE m.box_id = push_subs.box_id AND m.member_id = push_subs.member_id)`
    ),
    // NT-53: subscriptions with changes waiting that haven't been delivered for
    // 60 days (the push service keeps failing), and day counters of past days.
    env.DB.prepare(
      "DELETE FROM push_subs WHERE pending_count > 0 AND COALESCE(last_sent_at, created_at) < ?"
    ).bind(nowMs - PUSH_UNDELIVERED_TTL_MS),
    env.DB.prepare("UPDATE push_subs SET day = NULL, sent_today = 0 WHERE day < ?").bind(utcDay(nowMs)),
    // NT-13, NT-53: expired invites lose their join hash, so the link can't be used.
    env.DB.prepare(
      "UPDATE boxes SET join_hash = NULL WHERE join_hash IS NOT NULL AND invite_expires_at <= ?"
    ).bind(nowMs),
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
    // CO-8: coach counters are only needed for the current day, or for monthly ones
    // ("m:…", whose `day` is a month like "2026-11") the current month.
    env.DB.prepare(
      "DELETE FROM coach_usage WHERE (key NOT LIKE 'm:%' AND day < ?1) OR (key LIKE 'm:%' AND day < ?2)"
    ).bind(new Date(nowMs - DAY_MS).toISOString().slice(0, 10), new Date(nowMs).toISOString().slice(0, 7)),
  ]);
  const changes = (i: number) => results[i]?.meta.changes ?? 0;
  const counts = {
    purgedMenus: changes(0),
    purgedAccounts: changes(1),
    purgedBoxes: changes(5),
    orphanSubscriptions: changes(6),
    undeliveredSubscriptions: changes(7),
    expiredInvites: changes(9),
    tombstones: changes(11),
    pairings: changes(12),
    events: changes(13),
    coachCounters: changes(14),
  };
  log({ route: "cron daily", status: 200, code: "purged", ...counts });
  return counts;
};
