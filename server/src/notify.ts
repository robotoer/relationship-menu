/**
 * Notifications for live-sharing boxes (docs/spec/notifications.md §4, §7b,
 * §7c; NT-23…NT-28, NT-40, NT-55, NT-56): the subscription routes, telling the
 * other members' devices about a write, and the 5-minute flush of what was held
 * back. A subscription is either a browser's web push subscription (webpush.ts)
 * or a store app's FCM registration token (fcm.ts); both are scheduled, claimed
 * and retried the same way.
 *
 * When a push may go out is decided by push.ts. Here each decision is applied to
 * its D1 row with a compare-and-set, so two concurrent writes can never both
 * send within one window; a change that loses the race stays waiting.
 *
 * Nothing about a push is logged except route, status and code (SY-44): never an
 * endpoint, token, key, id or payload.
 */

import type { Member } from "./boxes";
import { ID_PATTERN, fromBase64Url, toBase64Url } from "./bytes";
import { PUSH_LIMITS, type Env } from "./env";
import {
  FCM_TOKEN_PATTERN,
  fcmAccessToken,
  fcmAccount,
  isFcmPlatform,
  sendFcm,
  type AccessToken,
  type FcmAccount,
  type FcmPlatform,
  type PushOutcome,
} from "./fcm";
import { HttpError, json, noContent, parseJson } from "./http";
import { log } from "./log";
import { DAILY_LIMIT, WINDOW_MS, flush, utcDay, type Kind, type Send, type SubState } from "./push";
import { isPushEndpoint, pushConfigured, sendPush, type FetchLike, type VapidEnv } from "./webpush";

type SubRow = {
  sub_id: string;
  box_id: string;
  member_id: string;
  /** Web push: the endpoint URL. FCM: the registration token. */
  endpoint: string;
  /** Web push keys; empty for FCM. */
  p256dh: string;
  auth: string;
  created_at: number;
  last_sent_at: number | null;
  pending_kind: Kind | null;
  pending_count: number;
  day: string | null;
  sent_today: number;
  kind: "webpush" | "fcm";
  platform: FcmPlatform | null;
};

/** The channels that have working credentials right now (each is off without them). */
type Channels = { webpush: VapidEnv | null; fcm: FcmAccount | null };

const channels = async (env: Env): Promise<Channels> => ({
  webpush: pushConfigured(env) ? env : null,
  fcm: await fcmAccount(env),
});

const unavailable = () => new HttpError(503, "push_unavailable");

/** GET /v1/push/key — the VAPID public key the browser subscribes with. */
export const getPushKey = (env: Env): Response => {
  if (!pushConfigured(env)) throw unavailable();
  return json({ key: env.VAPID_PUBLIC_KEY });
};

type NewSubscription = { kind: SubRow["kind"]; endpoint: string; p256dh: string; auth: string; platform: FcmPlatform | null };

/**
 * POST /v1/boxes/:id/subscriptions — either {endpoint, p256dh, auth} from the
 * browser's PushSubscription (`kind` omitted or "webpush", §7b), or
 * {kind: "fcm", token, platform} from a store app (§7c). The same endpoint or
 * token for the same member device gets its existing subId back (with the keys
 * or platform it sent now). Each kind answers 503 push_unavailable while its
 * own credentials are missing.
 */
export const createSubscription = async (env: Env, member: Member, body: Uint8Array): Promise<Response> => {
  const ready = await channels(env);
  if (!ready.webpush && !ready.fcm) throw unavailable();
  const input = parseJson(body);
  let sub: NewSubscription;
  if (input.kind === undefined || input.kind === "webpush") {
    if (!ready.webpush) throw unavailable();
    const { endpoint, p256dh, auth } = input;
    if (typeof endpoint !== "string" || typeof p256dh !== "string" || typeof auth !== "string") {
      throw new HttpError(400, "bad_request");
    }
    const publicKey = fromBase64Url(p256dh);
    const authSecret = fromBase64Url(auth);
    if (publicKey?.length !== 65 || publicKey[0] !== 0x04 || authSecret?.length !== 16) throw new HttpError(400, "bad_request");
    if (!isPushEndpoint(endpoint)) throw new HttpError(400, "bad_endpoint");
    sub = { kind: "webpush", endpoint, p256dh, auth, platform: null };
  } else if (input.kind === "fcm") {
    if (!ready.fcm) throw unavailable();
    const { token, platform } = input;
    if (typeof token !== "string" || !FCM_TOKEN_PATTERN.test(token) || !isFcmPlatform(platform)) {
      throw new HttpError(400, "bad_request");
    }
    sub = { kind: "fcm", endpoint: token, p256dh: "", auth: "", platform };
  } else {
    throw new HttpError(400, "bad_request");
  }

  const subId = toBase64Url(crypto.getRandomValues(new Uint8Array(16)));
  const b = member.boxId;
  const m = member.memberId;
  // One transaction: refresh an existing subscription for this endpoint (or
  // token), or add one if there's none and the device is under its limit, which
  // counts both kinds together.
  const [updated, inserted] = await env.DB.batch<{ sub_id: string }>([
    env.DB.prepare(
      `UPDATE push_subs SET p256dh = ?4, auth = ?5, platform = ?6
       WHERE box_id = ?1 AND member_id = ?2 AND endpoint = ?3 AND kind = ?7 RETURNING sub_id`
    ).bind(b, m, sub.endpoint, sub.p256dh, sub.auth, sub.platform, sub.kind),
    env.DB.prepare(
      `INSERT INTO push_subs (sub_id, box_id, member_id, endpoint, p256dh, auth, created_at, kind, platform)
       SELECT ?8, ?1, ?2, ?3, ?4, ?5, ?9, ?7, ?6
       WHERE NOT EXISTS (SELECT 1 FROM push_subs WHERE box_id = ?1 AND member_id = ?2 AND endpoint = ?3)
         AND (SELECT COUNT(*) FROM push_subs WHERE box_id = ?1 AND member_id = ?2) < ?10
       RETURNING sub_id`
    ).bind(b, m, sub.endpoint, sub.p256dh, sub.auth, sub.platform, sub.kind, subId, Date.now(), PUSH_LIMITS.subscriptions),
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

/** What a web push service's status means (§7b): the same outcomes as FCM's (fcm.ts). */
const webPushOutcome = (status: number): PushOutcome => {
  if (status >= 200 && status < 300) return { result: "sent", status, code: "sent" };
  if (status === 404 || status === 410) return { result: "gone", status, code: "push_gone" };
  if (status === 0) return { result: "retry", status, code: "push_unreachable" };
  if (status === 429 || status >= 500) return { result: "retry", status, code: "push_retry" };
  return { result: "failed", status, code: "push_failed" };
};

/** A row's address is one the Worker will call: an allowed push endpoint (NT-55), or a well-formed FCM token. */
const addressable = (row: SubRow): boolean =>
  row.kind === "fcm" ? FCM_TOKEN_PATTERN.test(row.endpoint) : isPushEndpoint(row.endpoint);

/**
 * Sends to every row whose waiting changes may go out now (push.ts `flush`),
 * each through its own channel: web push or FCM. A row whose channel has no
 * working credentials is left as it is, waiting. Each send is first claimed in
 * D1, conditional on the row being exactly as read, so a concurrent write or
 * cron can't send it twice. Then:
 * - sent: done;
 * - gone (web push 404 / 410; FCM 404, UNREGISTERED, a bad token): the
 *   subscription is deleted (NT-28);
 * - retry (429, 5xx, no answer) or auth (FCM 401 / 403, or no access token):
 *   the claim is undone and the changes wait for the next cron (§7b, §7c), so a
 *   push that didn't arrive doesn't use up the window;
 * - failed (any other answer: a 3xx or 4xx won't succeed by retrying): logged, dropped.
 */
const deliver = async (env: Env, ready: Channels, rows: SubRow[], nowMs: number, fetchImpl?: FetchLike): Promise<Delivery> => {
  const result: Delivery = { sent: 0, waiting: 0, retry: 0, gone: 0, failed: 0 };
  const plans: { row: SubRow; send: Send; next: SubState }[] = [];
  const disallowed: SubRow[] = [];
  for (const row of rows) {
    // Checked when subscribing; checked again so the Worker never calls anything else (NT-55).
    if (!addressable(row)) {
      disallowed.push(row);
      continue;
    }
    const { send, next } = flush(stateOf(row), nowMs);
    // Without its channel's credentials a change just waits, for when they're back.
    if (send && (row.kind === "fcm" ? ready.fcm : ready.webpush)) plans.push({ row, send, next });
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

  // One FCM access token for the round (cached across rounds, fcm.ts). If there's
  // none, every FCM send of this round waits, logged once.
  const fcmCount = claimed.filter(({ row }) => row.kind === "fcm").length;
  let fcmAuth: AccessToken | null = null;
  if (fcmCount > 0 && ready.fcm) {
    fcmAuth = await fcmAccessToken(ready.fcm, { fetch: fetchImpl, nowMs }).catch(
      (): AccessToken => ({ ok: false, outcome: { result: "auth", status: 0, code: "push_auth" } })
    );
    if (!fcmAuth.ok) log({ route: "push fcm token", status: fcmAuth.outcome.status, code: fcmAuth.outcome.code, subscriptions: fcmCount });
  }

  const unreachable: PushOutcome = { result: "retry", status: 0, code: "push_unreachable" };
  const outcomes = await Promise.all(
    claimed.map(async ({ row, send }): Promise<{ outcome: PushOutcome; logged: boolean }> => {
      const payload = { box: row.box_id, ...send };
      if (row.kind === "webpush") {
        const status = await sendPush(ready.webpush!, row, payload, fetchImpl, nowMs).catch(() => 0);
        return { outcome: webPushOutcome(status), logged: false };
      }
      // A token failure was logged once above.
      if (!fcmAuth?.ok) return { outcome: fcmAuth?.outcome ?? unreachable, logged: fcmAuth !== null };
      const outcome = await sendFcm(ready.fcm!, fcmAuth.token, row.endpoint, payload, { fetch: fetchImpl, nowMs }).catch(() => unreachable);
      return { outcome, logged: false };
    })
  );
  const followUps: D1PreparedStatement[] = [];
  claimed.forEach(({ row, send, next }, i) => {
    const { outcome, logged } = outcomes[i]!;
    const route = row.kind === "fcm" ? "push fcm" : "push";
    if (outcome.result !== "sent" && !logged) log({ route, status: outcome.status, code: outcome.code });
    if (outcome.result === "sent") {
      result.sent++;
    } else if (outcome.result === "gone") {
      result.gone++;
      followUps.push(env.DB.prepare("DELETE FROM push_subs WHERE sub_id = ?").bind(row.sub_id));
    } else if (outcome.result === "retry" || outcome.result === "auth") {
      result.retry++;
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
    }
  });
  if (followUps.length > 0) await env.DB.batch(followUps);
  return result;
};

/**
 * A member device wrote its copy with `Notify: comment|notes` (NT-23): every
 * subscription of every other member device in the box gets the change, which
 * goes out now or waits (NT-24). Runs after the response (ctx.waitUntil). With
 * no push credentials at all push is off and nothing is recorded; with one
 * channel's missing, its subscriptions keep the change waiting.
 */
export const notifyBox = async (
  env: Env,
  boxId: string,
  writerId: string,
  kind: Kind,
  nowMs = Date.now(),
  fetchImpl?: FetchLike
): Promise<Delivery | null> => {
  const ready = await channels(env);
  if (!ready.webpush && !ready.fcm) return null;
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
  return deliver(env, ready, rows.results, nowMs, fetchImpl);
};

/**
 * The 5-minute cron (NT-24): sends what's waiting wherever the window has passed
 * and the day allows, at most PUSH_LIMITS.flushBatch subscriptions per run,
 * those waiting longest first. Only channels with credentials are looked at;
 * the others' subscriptions keep waiting.
 */
export const flushPending = async (env: Env, nowMs = Date.now(), fetchImpl?: FetchLike): Promise<Delivery | null> => {
  const ready = await channels(env);
  if (!ready.webpush && !ready.fcm) return null;
  const rows = await env.DB.prepare(
    `SELECT * FROM push_subs
     WHERE pending_count > 0 AND (last_sent_at IS NULL OR last_sent_at <= ?1)
       AND (day IS NOT ?2 OR sent_today < ?3)
       AND ((?5 = 1 AND kind = 'webpush') OR (?6 = 1 AND kind = 'fcm'))
     ORDER BY last_sent_at LIMIT ?4`
  )
    .bind(nowMs - WINDOW_MS, utcDay(nowMs), DAILY_LIMIT, PUSH_LIMITS.flushBatch, ready.webpush ? 1 : 0, ready.fcm ? 1 : 0)
    .all<SubRow>();
  const result = await deliver(env, ready, rows.results, nowMs, fetchImpl);
  if (rows.results.length > 0) log({ route: "cron push", status: 200, code: "flushed", ...result });
  return result;
};
