/**
 * When a subscription is notified (docs/spec/notifications.md NT-24, §7b): a
 * pure state machine, with no I/O and no clock of its own, so it can be tested
 * exhaustively (test/push.test.ts) and mirrors `Notify.tla`.
 *
 * - A change is offered to a subscription. It goes out now if at least 15
 *   minutes have passed since that subscription's last push and it has had fewer
 *   than 20 today (UTC day); the push then counts every waiting change plus this
 *   one, and says `comment` if any of them was a comment, else `notes`.
 * - Otherwise it waits (`pendingCount + 1`; `pendingKind` becomes `comment` if
 *   this one is), and a cron every 5 minutes flushes whatever may go out.
 *
 * notify.ts applies these steps to D1 rows; the database does the "it waits"
 * step itself (an atomic increment mirroring `addPending`), so concurrent writes
 * never lose a change.
 */

export type Kind = "comment" | "notes";

export type SubState = {
  /** When the last push went out (ms), or null if none has. */
  lastSentAt: number | null;
  /** `comment` if any waiting change is a comment, else `notes`; null when nothing waits. */
  pendingKind: Kind | null;
  /** How many changes are waiting. */
  pendingCount: number;
  /** The UTC day (YYYY-MM-DD) `sentToday` counts, or null. */
  day: string | null;
  sentToday: number;
};

/** A push to send now: the payload's `kind` and `count` (NT-25). */
export type Send = { kind: Kind; count: number };

export type Step = { send: Send | null; next: SubState };

/** At most one push per subscription in this long (NT-24). */
export const WINDOW_MS = 15 * 60 * 1000;
/** At most this many pushes per subscription per UTC day (NT-24). */
export const DAILY_LIMIT = 20;
/** How often the cron flushes waiting changes (wrangler.toml). */
export const FLUSH_EVERY_MS = 5 * 60 * 1000;
/** The cron expression of that flush; any other cron is the daily one. */
export const PUSH_CRON = "*/5 * * * *";

/** A subscription that has never been notified. */
export const FRESH: SubState = { lastSentAt: null, pendingKind: null, pendingCount: 0, day: null, sentToday: 0 };

export const utcDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** `comment` beats `notes`. */
export const mergeKind = (waiting: Kind | null, kind: Kind): Kind =>
  waiting === "comment" || kind === "comment" ? "comment" : "notes";

/** Pushes already sent on `day` (a new day starts at 0). */
export const sentOn = (state: SubState, day: string): number => (state.day === day ? state.sentToday : 0);

/** Whether a push may go out at `nowMs`: the window has passed and the day allows. */
export const canSend = (state: SubState, nowMs: number): boolean =>
  (state.lastSentAt === null || nowMs - state.lastSentAt >= WINDOW_MS) && sentOn(state, utcDay(nowMs)) < DAILY_LIMIT;

/** One more change waits. */
export const addPending = (state: SubState, kind: Kind): SubState => ({
  ...state,
  pendingCount: state.pendingCount + 1,
  pendingKind: mergeKind(state.pendingKind, kind),
});

/** Sends whatever is waiting, if it may go out now (the cron, and the end of `offer`). */
export const flush = (state: SubState, nowMs: number): Step => {
  if (state.pendingCount <= 0 || !canSend(state, nowMs)) return { send: null, next: state };
  const day = utcDay(nowMs);
  return {
    send: { kind: state.pendingKind ?? "notes", count: state.pendingCount },
    next: { lastSentAt: nowMs, pendingKind: null, pendingCount: 0, day, sentToday: sentOn(state, day) + 1 },
  };
};

/** A member wrote with `Notify: <kind>`: offered to one subscription of another member. */
export const offer = (state: SubState, kind: Kind, nowMs: number): Step => flush(addPending(state, kind), nowMs);
