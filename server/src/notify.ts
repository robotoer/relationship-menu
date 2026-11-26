/**
 * Notifications for live-sharing boxes (docs/spec/notifications.md §4, §7b;
 * NT-23…NT-28, NT-55, NT-56): the subscription routes, telling the other
 * members' devices about a write, and the 5-minute flush of what was held back.
 *
 * When a push may go out is decided by push.ts. Here each decision is applied to
 * its D1 row with a compare-and-set, so two concurrent writes can never both
 * send within one window; a change that loses the race stays waiting.
 *
 * Nothing about a push is logged except route, status and code (SY-44): never an
 * endpoint, key, id or payload.
 */

import type { Member } from "./boxes";
import { ID_PATTERN, fromBase64Url, toBase64Url } from "./bytes";
import { PUSH_LIMITS, type Env } from "./env";
import { HttpError, json, noContent, parseJson } from "./http";
import { log } from "./log";
import { DAILY_LIMIT, WINDOW_MS, flush, utcDay, type Kind, type Send, type SubState } from "./push";
import { isPushEndpoint, pushConfigured, sendPush, type FetchLike, type VapidEnv } from "./webpush";

type SubRow = {
  sub_id: string;
  box_id: string;
  member_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  created_at: number;
  last_sent_at: number | null;
  pending_kind: Kind | null;
  pending_count: number;
  day: string | null;
  sent_today: number;
};

const unavailable = () => new HttpError(503, "push_unavailable");

/** GET /v1/push/key — the VAPID public key the browser subscribes with. */
export const getPushKey = (env: Env): Response => {
  if (!pushConfigured(env)) throw unavailable();
  return json({ key: env.VAPID_PUBLIC_KEY });
};

/**
 * POST /v1/boxes/:id/subscriptions — body {endpoint, p256dh, auth} from the
 * browser's PushSubscription. The same endpoint for the same member device gets
 * its existing subId back (with the keys it sent now).
 */
export const createSubscription = async (env: Env, member: Member, body: Uint8Array): Promise<Response> => {
  if (!pushConfigured(env)) throw unavailable();
  const input = parseJson(body);
  if (input.kind !== undefined && input.kind !== "webpush") throw new HttpError(400, "bad_request");
  const { endpoint, p256dh, auth } = input;
  if (typeof endpoint !== "string" || typeof p256dh !== "string" || typeof auth !== "string") {
    throw new HttpError(400, "bad_request");
  }
  const publicKey = fromBase64Url(p256dh);
  const authSecret = fromBase64Url(auth);
  if (publicKey?.length !== 65 || publicKey[0] !== 0x04 || authSecret?.length !== 16) throw new HttpError(400, "bad_request");
  if (!isPushEndpoint(endpoint)) throw new HttpError(400, "bad_endpoint");

  const subId = toBase64Url(crypto.getRandomValues(new Uint8Array(16)));
  const b = member.boxId;
  const m = member.memberId;
  // One transaction: refresh an existing subscription for this endpoint, or add
  // one if there's none and the device is under its limit.
  const [updated, inserted] = await env.DB.batch<{ sub_id: string }>([
    env.DB.prepare(
      "UPDATE push_subs SET p256dh = ?4, auth = ?5 WHERE box_id = ?1 AND member_id = ?2 AND endpoint = ?3 RETURNING sub_id"
    ).bind(b, m, endpoint, p256dh, auth),
    env.DB.prepare(
      `INSERT INTO push_subs (sub_id, box_id, member_id, endpoint, p256dh, auth, created_at)
       SELECT ?6, ?1, ?2, ?3, ?4, ?5, ?7
       WHERE NOT EXISTS (SELECT 1 FROM push_subs WHERE box_id = ?1 AND member_id = ?2 AND endpoint = ?3)
         AND (SELECT COUNT(*) FROM push_subs WHERE box_id = ?1 AND member_id = ?2) < ?8
       RETURNING sub_id`
    ).bind(b, m, endpoint, p256dh, auth, subId, Date.now(), PUSH_LIMITS.subscriptions),
  ]);
  const id = updated?.results[0]?.sub_id ?? inserted?.results[0]?.sub_id;
  if (!id) throw new HttpError(409, "too_many_subscriptions", { limit: PUSH_LIMITS.subscriptions });
  return json({ subId: id }, 201);
};

/** DELETE /v1/boxes/:id/subscriptions/:subId (NT-28) — the caller's own subscription only. */
export const deleteSubscription = async (env: Env, member: Member, subId: string): Promise<Response> => {
  if (!ID_PATTERN.test(subId)) throw new HttpError(400, "bad_request");
  const deleted = await env.DB.prepare("DELETE FROM push_subs WHERE sub_id = ? AND box_id = ? AND member_id = ?")
    .bind(subId, member.boxId, member.memberId)
    .run();
  if (deleted.meta.changes !== 1) throw new HttpError(404, "not_found");
  return noContent();
};

/** The `Notify` header of a copy write (§7a): `comment`, `notes`, or anything else for none. */
export const notifyKind = (header: string | null): Kind | null => {
  const value = header?.trim().toLowerCase();
  return value === "comment" || value === "notes" ? value : null;
};

const stateOf = (row: SubRow): SubState => ({
  lastSentAt: row.last_sent_at,
  pendingKind: row.pending_kind,
  pendingCount: row.pending_count,
  day: row.day,
  sentToday: row.sent_today,
});

/** What one delivery round did, for tests and the cron's log line. */
export type Delivery = { sent: number; waiting: number; retry: number; gone: number; failed: number };

/**
 * Sends to every row whose waiting changes may go out now (push.ts `flush`).
 * Each send is first claimed in D1, conditional on the row being exactly as
 * read, so a concurrent write or cron can't send it twice. Then:
 * - 2xx: done;
 * - 404 / 410: the push service has forgotten the subscription; it's deleted (NT-28);
 * - 429, 5xx, or no answer: the claim is undone and the changes wait for the
 *   next cron (§7b), so a push that didn't arrive doesn't use up the window;
 * - any other answer (a 3xx or 4xx won't succeed by retrying): logged, dropped.
 */
const deliver = async (env: VapidEnv, rows: SubRow[], nowMs: number, fetchImpl?: FetchLike): Promise<Delivery> => {
  const result: Delivery = { sent: 0, waiting: 0, retry: 0, gone: 0, failed: 0 };
  const plans: { row: SubRow; send: Send; next: SubState }[] = [];
  const disallowed: SubRow[] = [];
  for (const row of rows) {
    // Checked when subscribing; checked again so the Worker never calls anything else (NT-55).
    if (!isPushEndpoint(row.endpoint)) {
      disallowed.push(row);
      continue;
    }
    const { send, next } = flush(stateOf(row), nowMs);
    if (send) plans.push({ row, send, next });
    else if (row.pending_count > 0) result.waiting++;
  }
  if (plans.length === 0 && disallowed.length === 0) return result;

  const claims = await env.DB.batch<{ sub_id: string }>([
    ...plans.map(({ row, next }) =>
      env.DB.prepare(
        `UPDATE push_subs SET last_sent_at = ?2, pending_kind = NULL, pending_count = 0, day = ?3, sent_today = ?4
         WHERE sub_id = ?1 AND last_sent_at IS ?5 AND pending_kind IS ?6 AND pending_count = ?7 AND day IS ?8 AND sent_today = ?9
         RETURNING sub_id`
      ).bind(row.sub_id, next.lastSentAt, next.day, next.sentToday, row.last_sent_at, row.pending_kind, row.pending_count, row.day, row.sent_today)
    ),
    ...disallowed.map((row) => env.DB.prepare("DELETE FROM push_subs WHERE sub_id = ?").bind(row.sub_id)),
  ]);
  result.gone += disallowed.length;
  // A claim that matched nothing lost a race: whoever changed the row sends (or keeps it waiting).
  const claimed = plans.filter((_, i) => (claims[i]?.results.length ?? 0) === 1);
  result.waiting += plans.length - claimed.length;

  const statuses = await Promise.all(
    claimed.map(({ row, send }) => sendPush(env, row, { box: row.box_id, ...send }, fetchImpl, nowMs).catch(() => 0))
  );
  const followUps: D1PreparedStatement[] = [];
  claimed.forEach(({ row, send, next }, i) => {
    const status = statuses[i] ?? 0;
    if (status >= 200 && status < 300) {
      result.sent++;
    } else if (status === 404 || status === 410) {
      result.gone++;
      log({ route: "push", status, code: "push_gone" });
      followUps.push(env.DB.prepare("DELETE FROM push_subs WHERE sub_id = ?").bind(row.sub_id));
    } else if (status === 0 || status === 429 || status >= 500) {
      result.retry++;
      log({ route: "push", status, code: status === 0 ? "push_unreachable" : "push_retry" });
      // Undo the claim: the changes wait again (with any that arrived meanwhile),
      // and the window and day count go back to before this attempt.
      followUps.push(
        env.DB.prepare(
          `UPDATE push_subs SET
             pending_count = pending_count + ?2,
             pending_kind = CASE WHEN ?3 = 'comment' OR pending_kind = 'comment' THEN 'comment' ELSE 'notes' END,
             last_sent_at = CASE WHEN last_sent_at IS ?4 THEN ?5 ELSE last_sent_at END,
             day = CASE WHEN last_sent_at IS ?4 THEN ?6 ELSE day END,
             sent_today = CASE WHEN last_sent_at IS ?4 THEN ?7 ELSE sent_today END
           WHERE sub_id = ?1`
        ).bind(row.sub_id, send.count, send.kind, next.lastSentAt, row.last_sent_at, row.day, row.sent_today)
      );
    } else {
      result.failed++;
      log({ route: "push", status, code: "push_failed" });
    }
  });
  if (followUps.length > 0) await env.DB.batch(followUps);
  return result;
};

/**
 * A member device wrote its copy with `Notify: comment|notes` (NT-23): every
 * subscription of every other member device in the box gets the change, which
 * goes out now or waits (NT-24). Runs after the response (ctx.waitUntil).
 */
export const notifyBox = async (
  env: Env,
  boxId: string,
  writerId: string,
  kind: Kind,
  nowMs = Date.now(),
  fetchImpl?: FetchLike
): Promise<Delivery | null> => {
  if (!pushConfigured(env)) return null;
  // The change waits on every subscription first, atomically (push.ts addPending),
  // so it's never lost; each row then comes back as it is now, to flush.
  const rows = await env.DB.prepare(
    `UPDATE push_subs SET pending_count = pending_count + 1,
       pending_kind = CASE WHEN ?3 = 'comment' OR pending_kind = 'comment' THEN 'comment' ELSE 'notes' END
     WHERE box_id = ?1 AND member_id <> ?2
     RETURNING *`
  )
    .bind(boxId, writerId, kind)
    .all<SubRow>();
  return deliver(env, rows.results, nowMs, fetchImpl);
};

/**
 * The 5-minute cron (NT-24): sends what's waiting wherever the window has passed
 * and the day allows, at most PUSH_LIMITS.flushBatch subscriptions per run,
 * those waiting longest first.
 */
export const flushPending = async (env: Env, nowMs = Date.now(), fetchImpl?: FetchLike): Promise<Delivery | null> => {
  if (!pushConfigured(env)) return null;
  const rows = await env.DB.prepare(
    `SELECT * FROM push_subs
     WHERE pending_count > 0 AND (last_sent_at IS NULL OR last_sent_at <= ?1)
       AND (day IS NOT ?2 OR sent_today < ?3)
     ORDER BY last_sent_at LIMIT ?4`
  )
    .bind(nowMs - WINDOW_MS, utcDay(nowMs), DAILY_LIMIT, PUSH_LIMITS.flushBatch)
    .all<SubRow>();
  const result = await deliver(env, rows.results, nowMs, fetchImpl);
  if (rows.results.length > 0) log({ route: "cron push", status: 200, code: "flushed", ...result });
  return result;
};
