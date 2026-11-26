/**
 * Supporter sync: the push queue and pulls (spec §6, SY-31, SY-32; server API in
 * server/README.md).
 *
 * A pure state machine. `nextRequest` says what to send next (one request at a
 * time) or how long to wait; `receive` applies the reply. Timing (the 2 s push
 * delay, 5-minute pulls, retry backoff) is data in the state, so the caller owns
 * the timers. There is no `fetch` here: `syncStep` takes a transport, which the
 * client wires to signed requests and the records layer (encrypt and decrypt).
 * The merge rules themselves are in `merge.ts`.
 */

import {
  ConflictCopy,
  Local,
  MergeContext,
  MergeResult,
  MovedMenu,
  Push,
  RemoteRecord,
  applyLocalDelete,
  applyLocalSave,
  applyPushed,
  applyRejected,
  applyResync,
  applyUnknownCreate,
  dropUnsentDeletes,
  mergeRecords,
  pushesFor,
} from "./merge";
import type { SavedMenu } from "../menu-store";

/** SY-31: changes are pushed about 2 s after the last save. */
export const PUSH_DELAY_MS = 2_000;
/** SY-32: pulls every 5 minutes (while the page is visible; the caller pauses it). */
export const PULL_EVERY_MS = 5 * 60_000;
/** SY-31: retries back off from 1 s, doubling, up to 5 minutes. */
export const RETRY_MIN_MS = 1_000;
export const RETRY_MAX_MS = 5 * 60_000;

/** How long to wait after `failures` failed requests in a row (at least 1). */
export const retryDelayMs = (failures: number) =>
  Math.min(RETRY_MAX_MS, RETRY_MIN_MS * 2 ** Math.max(0, Math.min(failures, 20) - 1));

/**
 * One request. A pull is `GET /v1/menus?since=`. A push is a `put` (PUT with
 * `If-Match: "<ifMatch>"`, or `If-None-Match: *` when `ifMatch` is null) or a
 * `delete` (DELETE with `If-Match`), whose body the transport encrypts.
 *
 * `full` marks the pages of a full listing: a pull that started from 0 (the
 * first one, or after `resync`). Without it, the server answers `resync` again
 * for every later page whose `since` is below the newest forgotten tombstone, so
 * a listing longer than one page never finishes. The server doesn't take the
 * flag yet (`&full=1`, a follow-up to server/src/menus.ts).
 */
export type Request = { kind: "pull"; since: number; full?: true } | Push;

/** The reply, already decrypted by the transport. */
export type Reply =
  /**
   * 200 from a pull: `{ menus, next, more, resync, purged }`. `purged` is the
   * account's newest forgotten tombstone (`purged_seq`); the server doesn't send
   * it yet (same follow-up). Without it, a tombstone forgotten while a full
   * listing is part-way can go unnoticed.
   */
  | { kind: "pulled"; records: RemoteRecord[]; next: number; more: boolean; resync: boolean; purged?: number }
  /** 200 from a push: `{ version, seq }`. */
  | { kind: "accepted"; version: number; seq: number }
  /** 412 from a push: `{ current }`. */
  | { kind: "rejected"; current: RemoteRecord | null }
  /**
   * No answer, a 5xx or a 429 (with its `Retry-After`). `notApplied` says the
   * server certainly didn't apply it (never sent while offline, or a 429);
   * otherwise a write may have landed with its reply lost.
   */
  | { kind: "failed"; retryAfterMs?: number; notApplied?: true }
  /** An answer that retrying won't change (402, 413, 507): pushes pause until `resumePushes`. */
  | { kind: "refused"; reason: string };

export type Engine = {
  local: Local;
  /** Highest `seq` pulled (`sync:cursor`). */
  cursor: number;
  /** A pull is part-way through its pages; the rest comes before any push. */
  pulling: boolean;
  /**
   * During a full listing (a pull that started from 0, the first one or after
   * `resync`): every id listed so far, and the server's `purged` when it began.
   * At its end, synced menus that weren't listed are treated as deleted (SY-32).
   */
  listing: Listing | null;
  pullWanted: boolean;
  nextPullAt: number;
  /** Earliest time to push: `PUSH_DELAY_MS` after the last save. */
  pushAt: number;
  /** The request sent and not yet answered (SY-31: one at a time). */
  inFlight: Request | null;
  /** Failed requests in a row, and when to try again. */
  failures: number;
  retryAt: number;
  /** Records skipped because they couldn't be read (SY-17), for "Some synced data couldn't be read." */
  unreadable: number;
  /** Why pushes are paused (`refused`), or null. */
  paused: string | null;
};

/** What a reply or a local save did, for the UI (SY-33, SY-35). */
export type SyncEvents = { copies: ConflictCopy[]; moved: MovedMenu[]; changed: string[]; unreadable: number };

const noEvents = (): SyncEvents => ({ copies: [], moved: [], changed: [], unreadable: 0 });

const addEvents = (events: SyncEvents, merge: MergeResult): SyncEvents => ({
  copies: [...events.copies, ...merge.copies],
  moved: [...events.moved, ...merge.moved],
  changed: [...events.changed, ...merge.changed.filter((id) => !events.changed.includes(id))],
  unreadable: events.unreadable + merge.unreadable,
});

const localOf = ({ menus, sync }: Local): Local => ({ menus, sync });

type Listing = { seen: string[]; purged: number | undefined };
const newListing = (purged?: number): Listing => ({ seen: [], purged });

/**
 * Starts syncing (on load, or when sync is turned on). Menus without a sync state
 * are new to the server and will be pushed (SY-13); the first thing it does is pull.
 */
export const createEngine = (local: Local, cursor: number, now: number, ctx: MergeContext): Engine => ({
  local: localOf(mergeRecords(local, [], ctx)),
  cursor,
  pulling: false,
  listing: null,
  pullWanted: true,
  nextPullAt: now + PULL_EVERY_MS,
  pushAt: now,
  inFlight: null,
  failures: 0,
  retryAt: 0,
  unreadable: 0,
  paused: null,
});

/** A save, already written to browser storage (SY-30). See `applyLocalSave` for `startedFrom`. */
export const saveLocally = (
  engine: Engine,
  doc: SavedMenu,
  startedFrom: number | null,
  now: number,
  ctx: MergeContext
): { engine: Engine; revision: number; events: SyncEvents } => {
  const saved = applyLocalSave(engine.local, doc, startedFrom, ctx);
  return {
    engine: { ...engine, local: localOf(saved), pushAt: now + PUSH_DELAY_MS },
    revision: saved.revision,
    events: addEvents(noEvents(), saved),
  };
};

/** A deletion here. A menu the server may never have had needs a pull to settle it. */
export const deleteLocally = (engine: Engine, id: string, now: number, ctx: MergeContext): Engine => {
  const before = engine.local.sync[id];
  const local = applyLocalDelete(engine.local, id, ctx);
  const unsent = before !== undefined && before.baseVersion === 0 && before.seenVersion === 0;
  return { ...engine, local, pushAt: now + PUSH_DELAY_MS, pullWanted: engine.pullWanted || unsent };
};

/** SY-32: on load, when the tab becomes visible, and after a rejected push. */
export const wantPull = (engine: Engine): Engine => ({ ...engine, pullWanted: true });

/** After `refused` (for example, supporter status came back). */
export const resumePushes = (engine: Engine): Engine => ({ ...engine, paused: null });

/** Pushes still to make. */
export const pendingPushes = (engine: Engine, deviceId: string): Push[] =>
  engine.paused === null ? pushesFor(engine.local, deviceId) : [];

export type Next = { engine: Engine; request: Request } | { engine: Engine; wait: number | null };

/**
 * What to send now, if anything. While a request is in flight the answer is to
 * wait for its reply (`wait: null`); otherwise `wait` is how long until there may
 * be something to do. A pull that has more pages comes first, then a wanted or
 * due pull, then the pushes in id order.
 */
export const nextRequest = (engine: Engine, now: number, deviceId: string): Next => {
  if (engine.inFlight) return { engine, wait: null };
  if (now < engine.retryAt) return { engine, wait: engine.retryAt - now };
  const send = (request: Request, changes: Partial<Engine> = {}): Next => ({
    engine: { ...engine, ...changes, inFlight: request },
    request,
  });
  const pull = (listing: Listing | null): Request =>
    listing ? { kind: "pull", since: engine.cursor, full: true } : { kind: "pull", since: engine.cursor };
  if (engine.pulling) return send(pull(engine.listing));
  if (engine.pullWanted || now >= engine.nextPullAt) {
    // From 0 the server lists every record it has: a full listing.
    const listing = engine.listing ?? (engine.cursor === 0 ? newListing() : null);
    return send(pull(listing), { pullWanted: false, pulling: true, listing });
  }
  const pushes = pendingPushes(engine, deviceId);
  if (pushes.length > 0 && now >= engine.pushAt) return send(pushes[0]);
  const until = Math.min(engine.nextPullAt, pushes.length > 0 ? engine.pushAt : Infinity);
  return { engine, wait: Math.max(0, until - now) };
};

const failed = (engine: Engine, now: number, retryAfterMs = 0): Engine => {
  const failures = engine.failures + 1;
  return { ...engine, failures, retryAt: now + Math.max(retryDelayMs(failures), retryAfterMs) };
};

/** Applies the reply to the request in flight. */
export const receive = (engine: Engine, reply: Reply, now: number, ctx: MergeContext): { engine: Engine; events: SyncEvents } => {
  const request = engine.inFlight;
  let events = noEvents();
  if (!request) return { engine, events };
  const idle: Engine = { ...engine, inFlight: null };
  const ok: Engine = { ...idle, failures: 0, retryAt: 0 };

  if (reply.kind === "failed") {
    const backoff = failed(idle, now, reply.retryAfterMs);
    if (request.kind !== "put" || request.ifMatch !== null || reply.notApplied) return { engine: backoff, events };
    // A new menu's first push may have landed: see applyUnknownCreate.
    const moved = applyUnknownCreate(engine.local, request, ctx);
    events = addEvents(events, moved);
    return { engine: { ...backoff, local: localOf(moved), pullWanted: true }, events };
  }

  if (request.kind === "pull") {
    if (reply.kind !== "pulled") return { engine: failed(idle, now), events };
    if (reply.resync) {
      // SY-32: our cursor is older than a tombstone the server forgot. Pull
      // everything, then treat synced menus that are missing as deleted.
      return { engine: { ...ok, cursor: 0, pulling: true, listing: newListing(reply.purged) }, events };
    }
    const merged = mergeRecords(engine.local, reply.records, ctx);
    events = addEvents(events, merged);
    let local = localOf(merged);
    const unreadable = engine.unreadable + merged.unreadable;
    let listing = engine.listing && {
      seen: [...engine.listing.seen, ...reply.records.map((r) => r.id)],
      purged: engine.listing.purged ?? reply.purged,
    };
    if (listing && reply.purged !== undefined && reply.purged !== listing.purged) {
      // A tombstone was forgotten part-way: a menu listed earlier may have been
      // deleted since, and its tombstone is gone. List everything again.
      return { engine: { ...ok, local, cursor: 0, pulling: true, listing: newListing(reply.purged), unreadable }, events };
    }
    if (reply.more) {
      return { engine: { ...ok, local, cursor: reply.next, pulling: true, listing, unreadable }, events };
    }
    if (listing) {
      const resynced = applyResync(local, new Set(listing.seen), ctx);
      events = addEvents(events, resynced);
      local = localOf(resynced);
      listing = null;
    }
    // Caught up, with nothing in flight: unsent deletions can be settled.
    local = dropUnsentDeletes(local);
    return {
      engine: { ...ok, local, cursor: reply.next, pulling: false, listing, unreadable, nextPullAt: now + PULL_EVERY_MS },
      events,
    };
  }

  // A push.
  if (reply.kind === "accepted") {
    return { engine: { ...ok, local: applyPushed(engine.local, request, reply.version) }, events };
  }
  if (reply.kind === "rejected") {
    const seen = engine.local.sync[request.id]?.seenVersion ?? 0;
    if (reply.current !== null && reply.current.version <= seen) {
      // Nothing newer than we had: retrying at once would only be rejected again.
      return { engine: failed(idle, now), events };
    }
    const merged = applyRejected(engine.local, request, reply.current, ctx);
    events = addEvents(events, merged);
    return {
      engine: { ...ok, local: localOf(merged), pullWanted: true, unreadable: engine.unreadable + merged.unreadable },
      events,
    };
  }
  if (reply.kind === "refused") return { engine: { ...ok, paused: reply.reason }, events };
  return { engine: failed(idle, now), events };
};

/** Sends a request and returns the reply. Throwing counts as `failed`. */
export type Transport = (request: Request) => Promise<Reply>;

/**
 * One round: send the next request, if any, and apply its reply. The engine is
 * read and written through `get`/`set`, so saves made while the request is in the
 * air aren't lost. Returns how long to wait before the next round (0: go again).
 */
export const syncStep = async (
  get: () => Engine,
  set: (engine: Engine) => void,
  transport: Transport,
  now: () => number,
  ctx: MergeContext
): Promise<{ events: SyncEvents; wait: number | null }> => {
  const next = nextRequest(get(), now(), ctx.deviceId);
  set(next.engine);
  if (!("request" in next)) return { events: noEvents(), wait: next.wait };
  let reply: Reply;
  try {
    reply = await transport(next.request);
  } catch {
    reply = { kind: "failed" };
  }
  const done = receive(get(), reply, now(), ctx);
  set(done.engine);
  return { events: done.events, wait: 0 };
};
