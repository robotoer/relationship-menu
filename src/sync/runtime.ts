/**
 * Supporter sync, running in the app (spec §2, §3, §6 and §8): the sync code and
 * keys, the account status, and the loop that drives the engine (engine.ts)
 * over the API (api.ts), with every record encrypted on this device (records.ts).
 *
 * Every tab records its own saves and deletions in browser storage
 * (local-store.ts) the moment they happen. One tab at a time, chosen with the Web
 * Locks API, does the network part; each round reads the menus and their sync
 * states afresh, so a save made in any tab meanwhile is never lost or
 * overwritten. Screens use this through `useSync()` (context.ts).
 */

import { track as trackEvent } from "../analytics";
import type { KeyValueStore } from "../menu-store";
import { newMenuId } from "../menu-id";
import { ApiError, ApiOptions, SyncApi, createApi, parseAccount, readPairing } from "./api";
import {
  CheckoutPlan,
  PairingOffer,
  SyncAccount,
  SyncActions,
  SyncError,
  SyncNotice,
  SyncState,
} from "./context";
import {
  Engine,
  Reply,
  Request,
  createEngine,
  pendingPushes,
  retryDelayMs,
  syncStep,
  PUSH_DELAY_MS,
  PULL_EVERY_MS,
} from "./engine";
import { SyncKeys, deriveKeys } from "./keys";
import {
  clearNextSecret,
  clearSyncState,
  readAccount,
  readCursor,
  readDeviceId,
  PartialWriteError,
  readLocal,
  readNextSecret,
  readReport,
  readSecret,
  readSkipped,
  readState,
  resetMenuStates,
  syncIsOn,
  writeAccount,
  writeLocal,
  writeNextSecret,
  writeReport,
  writeSecret,
  writeSkipped,
  SYNC_KEY,
  SYNC_MENU_PREFIX,
} from "./local-store";
import { MergeContext, RemoteRecord, recordVersion } from "./merge";
import { LocalSync, SyncHooks, createLocalSync, readSyncState } from "./hooks";
import { PairingError, createPairing, openPairing, pairingIdForKey, pairingLink } from "./pairing";
import { SyncRecordError, decryptRecord, encryptRecord } from "./records";
import { newSyncSecret, parseSyncCode, secretToWords } from "./sync-code";
import { syncSupported } from "./supported";

/** The Web Lock held by the tab that does the network part. */
export const SYNC_LOCK = "wantsandwonts-sync";
/** How often to check again whether a code replacement whose answer was lost happened. */
const ROTATION_RETRY_MS = 30_000;
/**
 * How long another tab leaves a code replacement to the tab doing it before
 * checking the outcome itself (that tab may have been closed part-way).
 */
const ROTATION_GRACE_MS = 2 * 60_000;
/**
 * How long after the request to move the account a "not moved" can be believed.
 * The server accepts its signature within 5 minutes of its time (SY-6), which with
 * this device's clock up to 5 minutes off means it can arrive up to 10 minutes
 * after it was sent; and the server commits a move within 60 s of its arrival or
 * not at all (server/src/accounts.ts ROTATION_COMMIT_MS). After 12 minutes it can
 * no longer happen.
 */
const ROTATION_SETTLE_MS = 12 * 60_000;
/** At most one account check a minute from tab switches. */
const ACCOUNT_CHECK_MS = 60_000;
/** The longest single timer (browsers overflow past 2^31 ms). */
const MAX_SLEEP_MS = 60 * 60_000;
const POKE_KEY = "sync:poke";

export type RuntimeOptions = {
  /** Browser storage (localStorage). */
  kv?: KeyValueStore;
  /** Where the API is and how to reach it ("" and `fetch` in the app). */
  api?: ApiOptions;
  /** This app's address, for pairing links. */
  origin?: string;
  now?: () => number;
  newId?: () => string;
  supported?: () => Promise<boolean>;
  /** Runs `task` while this tab is the one syncing. Default: the Web Locks API, else at once. */
  lead?: (task: () => Promise<void>) => void;
  isVisible?: () => boolean;
  /** Whether the browser thinks it's online. Offline, nothing is sent (so nothing can have landed). */
  isOnline?: () => boolean;
  /** Page events. Defaults: `visibilitychange`, and `storage` (changes made by other tabs). */
  onVisibilityChange?: (listener: () => void) => () => void;
  onStorage?: (listener: (key: string | null) => void) => () => void;
  track?: typeof trackEvent;
  /** The save hooks this runtime works with (lazy.ts makes them before the runtime loads). */
  local?: LocalSync;
};

export type { SyncHooks } from "./hooks";

export type SyncRuntime = SyncActions &
  SyncHooks & {
    /** Reads the code and starts syncing if it's on. */
    start(): Promise<void>;
    stop(): void;
    getState(): SyncState;
    subscribe(listener: () => void): () => void;
    /** Signs a request for another API call (the AI coach). Null with sync off. */
    authorizer(): ((method: string, pathAndQuery: string, body: Uint8Array) => Promise<string>) | null;
  };

type Loop = Omit<Engine, "local" | "cursor">;
/** One loop's state. The main loop and replaceCode's catch-up each have their own. */
type Holder = { loop: Loop };

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

const defaultLead = (task: () => Promise<void>) => {
  const locks = (globalThis.navigator as Navigator | undefined)?.locks;
  if (locks?.request) {
    locks.request(SYNC_LOCK, task).catch(() => undefined);
  } else {
    void task();
  }
};

/** An API failure as the screens see it. */
export const toSyncError = (error: unknown): SyncError => {
  if (error instanceof SyncError) return error;
  if (error instanceof PairingError) return new SyncError("pairing_unreadable");
  if (!(error instanceof ApiError)) return new SyncError("failed");
  if (error.status === 0 || error.status >= 500) return new SyncError("offline");
  if (error.status === 429) return new SyncError("rate_limited");
  if (error.status === 402) return new SyncError("not_supporter");
  if (error.code === "already_supporter") return new SyncError("already_supporter");
  return new SyncError("failed");
};

export const createSyncRuntime = (options: RuntimeOptions = {}): SyncRuntime => {
  const kv = options.kv ?? globalThis.localStorage;
  const now = options.now ?? Date.now;
  const newId = options.newId ?? newMenuId;
  const ctx: MergeContext = { newMenuId: newId, newEditId: newId };
  const apiOptions: ApiOptions = { now, ...options.api };
  const origin = options.origin ?? globalThis.location?.origin ?? "";
  const supported = options.supported ?? syncSupported;
  const lead = options.lead ?? defaultLead;
  const isVisible = options.isVisible ?? (() => globalThis.document?.visibilityState !== "hidden");
  const isOnline = options.isOnline ?? (() => globalThis.navigator?.onLine !== false);
  const track = options.track ?? trackEvent;
  const local = options.local ?? createLocalSync({ kv, now, ctx });
  const onVisibilityChange =
    options.onVisibilityChange ??
    ((listener) => {
      globalThis.document?.addEventListener("visibilitychange", listener);
      return () => globalThis.document?.removeEventListener("visibilitychange", listener);
    });
  const onStorage =
    options.onStorage ??
    ((listener) => {
      const handler = (event: StorageEvent) => listener(event.key);
      globalThis.window?.addEventListener("storage", handler);
      return () => globalThis.window?.removeEventListener("storage", handler);
    });

  let state: SyncState = { kind: "loading" };
  const listeners = new Set<() => void>();

  /** Bumps whenever the code changes (on, off, replaced): an older loop stops. */
  let generation = 0;
  /** Aborted at each bump, so an older loop sends nothing more (not even a request it was signing). */
  let stopSending = new AbortController();
  const bump = () => {
    generation += 1;
    stopSending.abort();
    stopSending = new AbortController();
    return generation;
  };
  let keys: SyncKeys | null = null;
  let api: SyncApi | null = null;
  let deviceId = "";
  /** The main loop, while this tab is the one syncing. */
  let main: Holder | null = null;
  let wake: (() => void) | null = null;
  let failing = false;
  let pullFinished = false;
  let accountCheckedAt = 0;
  let unsubscribe: (() => void)[] = [];
  let started = false;
  /** Bumps on every start and stop: a start still waiting on the support check after a stop gives up. */
  let startToken = 0;
  /** A request for the sync lock is queued (Web Locks would otherwise queue two). */
  let leadPending = false;
  /** Sync is paused for a code replacement (SY-8): under way in another tab, or its answer lost. */
  let rotationPending = false;
  /** This tab is replacing the code: it alone decides the outcome. */
  let rotation: Promise<void> | null = null;
  /** Set once start has checked support and read the code: until then the state stays "loading". */
  let ready = false;

  // ---- state for the screens --------------------------------------------------

  const computeState = (): SyncState => (!ready || state.kind === "unsupported" ? state : readSyncState(kv));

  const publish = (next: SyncState = computeState()) => {
    if (JSON.stringify(next) === JSON.stringify(state)) return;
    state = next;
    for (const listener of listeners) listener();
  };

  /** One update to the loop's notices (`sync:runtime`). */
  type ReportChange = {
    add?: SyncNotice[];
    remove?: SyncNotice[];
    lastSyncedAt?: number;
    /** Records found unreadable since the last update (SY-17). */
    unreadableAdded?: number;
    unreadableReset?: true;
  };
  /** Updates that couldn't be stored yet (storage full), as one: written with the next. */
  let owed: ReportChange[] = [];

  /** Several updates as one, as if applied in order: the last word on each notice wins. */
  const compact = (changes: ReportChange[]): ReportChange => {
    const last = new Map<SyncNotice, "add" | "remove">();
    let unreadableAdded = 0;
    let unreadableReset = false;
    let lastSyncedAt: number | undefined;
    for (const change of changes) {
      for (const n of change.add ?? []) last.set(n, "add");
      for (const n of change.remove ?? []) last.set(n, "remove");
      if (change.unreadableReset) {
        unreadableReset = true;
        unreadableAdded = 0;
      }
      unreadableAdded += change.unreadableAdded ?? 0;
      if (change.lastSyncedAt !== undefined) lastSyncedAt = change.lastSyncedAt;
    }
    const of = (op: "add" | "remove") => [...last].filter(([, o]) => o === op).map(([n]) => n);
    return {
      add: of("add"),
      remove: of("remove"),
      unreadableAdded,
      ...(unreadableReset ? { unreadableReset: true as const } : {}),
      ...(lastSyncedAt !== undefined ? { lastSyncedAt } : {}),
    };
  };

  /** The loop's own notices, for every tab (`sync:runtime`). Never throws. */
  const report = (change: ReportChange = {}) => {
    const all = compact([...owed, change]);
    try {
      writeNotices([all]);
      owed = [];
    } catch {
      // Browser storage is full: keep it (as one update, however many pile up) for the
      // next try. Sync carries on.
      owed = [all];
    }
    publish();
  };

  const writeNotices = (changes: ReportChange[]) => {
    if (!syncIsOn(kv)) return;
    const current = readReport(kv);
    const notices = new Set<SyncNotice>(current.notices.filter((n) => n !== "offline" && n !== "storage_full" && n !== "menu_too_large"));
    let { unreadable, lastSyncedAt } = current;
    for (const change of changes) {
      for (const n of change.add ?? []) notices.add(n);
      for (const n of change.remove ?? []) notices.delete(n);
      if (change.unreadableReset) unreadable = 0;
      unreadable += change.unreadableAdded ?? 0;
      if (change.lastSyncedAt !== undefined) lastSyncedAt = change.lastSyncedAt;
    }
    if (failing || rotationPending) notices.add("offline");
    if (main?.loop.paused === "storage_full") notices.add("storage_full");
    if (readSkipped(kv).size > 0) notices.add("menu_too_large");
    writeReport(kv, { lastSyncedAt, unreadable, notices: [...notices].sort() });
  };

  // ---- the loop ---------------------------------------------------------------

  const sleep = (ms: number | null) =>
    new Promise<void>((resolve) => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      const done = () => {
        if (timer !== null) clearTimeout(timer);
        if (wake === done) wake = null;
        resolve();
      };
      if (ms !== null) timer = setTimeout(done, Math.max(0, Math.min(ms, MAX_SLEEP_MS)));
      wake = done;
    });

  const poke = () => wake?.();

  /**
   * The engine as `syncStep` sees it: the holder's loop state, with menus and
   * cursor read afresh. `gen` is the code it works for: once the code has changed
   * (turned off, replaced, another account), its replies are for the old account
   * and are written nowhere.
   */
  const engineIO = (holder: Holder, gen: number) => ({
    get: (): Engine => ({ ...holder.loop, held: [...readSkipped(kv)], local: local.currentLocal(), cursor: readCursor(kv) }),
    set: (engine: Engine) => {
      const { local: next, cursor, ...rest } = engine;
      if (gen !== generation) {
        holder.loop = rest;
        return;
      }
      // Menus, their states and the cursor: all or nothing (writeLocal). If it throws,
      // the round is tried again from where it was, and its changes are announced then;
      // menus it couldn't put back are announced now (the retry won't see them change).
      let changed: string[];
      try {
        changed = writeLocal(kv, readLocal(kv), next, now(), [[SYNC_KEY.cursor, String(cursor)]]);
      } catch (error) {
        if (error instanceof PartialWriteError) local.emitMenus(error.menuIds);
        throw error;
      }
      holder.loop = rest;
      local.emitMenus(changed);
    },
  });

  const newLoop = (): Loop => {
    const { local: _local, cursor: _cursor, ...fresh } = createEngine(local.currentLocal(), readCursor(kv), now(), ctx);
    return fresh;
  };

  const skipMenu = (id: string) => {
    const skip = readSkipped(kv);
    skip.add(id);
    writeSkipped(kv, skip);
  };

  const decrypt = async (row: { id: string; version: number; deleted: boolean; ciphertext: string }): Promise<RemoteRecord> => {
    try {
      const record = await decryptRecord(keys as SyncKeys, row);
      return { id: row.id, version: row.version, readable: true, record };
    } catch {
      return { id: row.id, version: row.version, readable: false, claimsDeleted: row.deleted };
    }
  };

  const replyFor = async (error: unknown, request: Request, skip: (id: string, revision: number) => void): Promise<Reply> => {
    if (!(error instanceof ApiError)) return { kind: "failed" };
    if (error.status === 0 || error.status >= 500) {
      failing = true;
      return { kind: "failed" };
    }
    failing = false;
    if (error.status === 429) return { kind: "failed", retryAfterMs: error.retryAfterMs ?? 60_000, notApplied: true };
    if (request.kind !== "pull" && error.status === 412) {
      const current = error.details?.current;
      if (current && typeof current === "object") {
        const row = current as { id?: unknown; version?: unknown; deleted?: unknown; ciphertext?: unknown };
        if (typeof row.id === "string" && typeof row.version === "number" && typeof row.ciphertext === "string") {
          return { kind: "rejected", current: await decrypt({ id: row.id, version: row.version, deleted: row.deleted === true, ciphertext: row.ciphertext }) };
        }
      }
      return { kind: "rejected", current: null };
    }
    if (error.status === 402) {
      void refreshAccount();
      if (request.kind === "pull") return { kind: "failed", notApplied: true };
      return { kind: "refused", reason: error.code === "read_only" ? "read_only" : "not_supporter" };
    }
    if (error.status === 507 && request.kind !== "pull") return { kind: "refused", reason: "storage_full" };
    if (error.status === 413 && request.kind !== "pull") {
      skip(request.id, request.revision);
      return { kind: "failed", notApplied: true };
    }
    return { kind: "failed", notApplied: true };
  };

  /** A loop's requests, through its own API: once the code changes, it sends nothing more (SY-8, SY-9). */
  const transport = (currentKeys: SyncKeys, gen: number) =>
    sendFor(createApi(currentKeys, { ...apiOptions, signal: stopSending.signal }), currentKeys, gen);

  const sendFor = (current: SyncApi, currentKeys: SyncKeys, gen: number) => async (request: Request): Promise<Reply> => {
    // Only for the code this was sent under (another account's menus aren't set aside),
    // and only if the version that was too large is still the latest one here.
    const skip = (id: string, revision: number) => {
      if (gen !== generation) return;
      if ((readState(kv, id)?.revision ?? -1) !== revision) return;
      skipMenu(id);
    };
    if (!isOnline()) {
      failing = true;
      return { kind: "failed", notApplied: true };
    }
    if (request.kind === "pull") {
      try {
        const page = await current.pull(request.since, request.full === true);
        failing = false;
        const records = await Promise.all(page.menus.map(decrypt));
        pullFinished = !page.more && !page.resync;
        return { kind: "pulled", records, next: page.next, more: page.more, resync: page.resync, purged: page.purged };
      } catch (error) {
        return replyFor(error, request, skip);
      }
    }
    let record: Uint8Array;
    try {
      record = await encryptRecord(currentKeys, recordVersion(request), { ...request.record, deviceId });
    } catch (error) {
      if (error instanceof SyncRecordError && error.problem === "too_large") {
        // Set aside until it changes (SY-26): the rest keep syncing.
        skip(request.id, request.revision);
        return { kind: "failed", notApplied: true, retryAfterMs: 0 };
      }
      return { kind: "failed", notApplied: true };
    }
    // When the page is being hidden, the request must outlive it (SY-31).
    const keepalive = !isVisible();
    try {
      const done =
        request.kind === "put"
          ? await current.put(request.id, record, request.ifMatch, keepalive)
          : await current.remove(request.id, record, request.ifMatch, keepalive);
      failing = false;
      return { kind: "accepted", version: done.version, seq: done.seq };
    } catch (error) {
      return replyFor(error, request, skip);
    }
  };

  const mayPull = (account: SyncAccount | null) => account === null || account.status !== "none";

  /** Asks for the sync lock (SY-25), unless this tab already has it or is waiting for it. */
  const requestLead = () => {
    if (main || leadPending || !api || rotationPending || rotation) return;
    const token = startToken;
    leadPending = true;
    lead(async () => {
      // Stopped since it was asked for: give the lock back (a later start asks again).
      if (token !== startToken || !started) return;
      leadPending = false;
      // Whatever code is current once the lock is ours (it may have changed while queued).
      await runLoop(generation);
    });
  };

  const runLoop = async (gen: number) => {
    if (gen !== generation || !api || !keys || main) return;
    const send = transport(keys, gen);
    const holder: Holder = { loop: newLoop() };
    const io = engineIO(holder, gen);
    main = holder;
    let crashes = 0;
    try {
      while (gen === generation) {
        const account = readAccount(kv);
        if (!isVisible() && (!mayPull(account) || pendingPushes(io.get()).length === 0)) {
          // Hidden, and nothing that can be sent now: pulls wait while the page is hidden
          // (SY-32), so let a tab that's in view sync instead (SY-25). Showing this one
          // again, or a save here, asks for the lock again.
          break;
        }
        if (!mayPull(account)) {
          // Nothing to sync with until there's supporter status; refreshAccount wakes us.
          await sleep(PULL_EVERY_MS);
          continue;
        }
        let step: Awaited<ReturnType<typeof syncStep>>;
        try {
          step = await syncStep(io.get, io.set, send, now, ctx);
          crashes = 0;
        } catch {
          // Browser storage refused a write, say. Try again later; menus are untouched.
          holder.loop = { ...holder.loop, inFlight: null };
          await sleep(retryDelayMs(++crashes));
          continue;
        }
        if (gen !== generation) break;
        try {
          if (step.events.moved.length > 0) local.emitMenus([], step.events.moved);
        } catch {
          // A listener failed; the menus are stored either way.
        }
        const changes: Parameters<typeof report>[0] = {};
        if (step.events.unreadable > 0) {
          changes.unreadableAdded = step.events.unreadable;
          changes.add = ["unreadable"];
        }
        if (pullFinished && !holder.loop.pulling) {
          changes.lastSyncedAt = now();
          pullFinished = false;
        }
        report(changes);
        if (step.wait !== 0) await sleep(step.wait);
      }
    } finally {
      if (main === holder) main = null;
    }
  };

  /** After a save or deletion here: push about 2 s later (SY-31). */
  const pushSoon = () => {
    if (!main) return;
    const paused = main.loop.paused === "storage_full" ? null : main.loop.paused;
    main.loop = { ...main.loop, pushAt: now() + PUSH_DELAY_MS, paused };
    poke();
  };

  /** Pull now, and send what's waiting without the usual delay ("sync now", the page shown again). */
  const pullNow = (pushToo = false) => {
    if (!main) return;
    main.loop = { ...main.loop, pullWanted: true, ...(pushToo ? { pushAt: now() } : {}) };
    poke();
  };

  // ---- the code and the account -----------------------------------------------

  const refreshAccount = async (): Promise<SyncAccount | null> => {
    const current = api;
    if (!current) return null;
    accountCheckedAt = now();
    let account: SyncAccount;
    try {
      account = await current.account();
      failing = false;
    } catch (error) {
      // An answer for a code that has since changed says nothing about this one.
      if (current !== api) return readAccount(kv);
      if (error instanceof ApiError && (error.status === 0 || error.status >= 500)) failing = true;
      report();
      return readAccount(kv);
    }
    if (current !== api) return readAccount(kv);
    const before = readAccount(kv);
    writeAccount(kv, account);
    const wasKnown = before !== null && before.status !== "none";
    if (wasKnown && account.status === "none") report({ add: ["code_replaced"] });
    else if (account.status !== "none") report({ remove: ["code_replaced"] });
    else report();
    if (main && !account.readOnly && (main.loop.paused === "read_only" || main.loop.paused === "not_supporter")) {
      main.loop = { ...main.loop, paused: null };
    }
    poke();
    return account;
  };

  const activate = async () => {
    // This tab is replacing the code: it restarts sync itself when that's settled.
    if (rotation) return;
    const gen = bump();
    keys = null;
    api = null;
    main = null;
    poke();
    // A code replacement under way, or whose answer was lost: nothing syncs until it's
    // settled (SY-8). Another tab may be doing it: leave it to that tab for a while.
    const next = readNextSecret(kv);
    if (next && readSecret(kv)) {
      let outcome: "moved" | "not_moved" | "unknown" = "unknown";
      if (now() - next.at >= ROTATION_GRACE_MS) {
        outcome = await rotationOutcome(await deriveKeys(next.secret), next.sent);
        if (gen !== generation) return;
        if (outcome === "moved") adoptNewCode(next.secret);
        else if (outcome === "not_moved") clearNextSecret(kv);
      }
      next.secret.fill(0);
      rotationPending = outcome === "unknown";
    } else {
      rotationPending = false;
    }
    const secret = readSecret(kv);
    if (!secret) {
      ready = true;
      publish({ kind: "off" });
      return;
    }
    const derived = await deriveKeys(secret);
    secret.fill(0);
    if (gen !== generation) return;
    keys = derived;
    api = createApi(derived, apiOptions);
    deviceId = readDeviceId(kv, newId);
    ctx.deviceId = deviceId; // SY-35's tie-break
    ready = true;
    if (rotationPending) {
      // Still unknown (offline): sync nothing under either code until it's known. Try again soon.
      report();
      setTimeout(() => {
        if (gen === generation && rotationPending) void activate();
      }, ROTATION_RETRY_MS);
      return;
    }
    publish();
    requestLead();
    void refreshAccount();
  };

  /**
   * Whether the server moved the account to `next` (SY-8). Its rotation is one
   * transaction that copies the supporter status, so the new account has a status
   * exactly when it happened.
   */
  const rotationOutcome = async (next: SyncKeys, sentAt: number): Promise<"moved" | "not_moved" | "unknown"> => {
    try {
      const status = await createApi(next, apiOptions).accountStatus();
      // Only a plain answer decides; anything else is asked again later.
      if (status === null) return "unknown";
      if (status !== "none") return "moved";
      // Not moved yet. That's final only once the request can no longer be applied late.
      return now() - sentAt >= ROTATION_SETTLE_MS ? "not_moved" : "unknown";
    } catch {
      return "unknown";
    }
  };

  /** The account is under the new code now: keep it, and push every menu to it again. */
  const adoptNewCode = (secret: Uint8Array) => {
    writeSecret(kv, secret);
    clearNextSecret(kv);
    resetMenuStates(kv);
    owed = [];
    report({ remove: ["code_replaced", "unreadable"], unreadableReset: true });
  };

  const requireOn = (): { api: SyncApi; keys: SyncKeys } => {
    if (state.kind === "unsupported" || !ready) throw new SyncError("unavailable");
    if (!api || !keys) throw new SyncError("unavailable", "Sync is off.");
    return { api, keys };
  };

  /** Turns sync on with `secret`, keeping this device's menus (SY-13). */
  const enable = async (secret: Uint8Array, how: "new" | "restored", method?: "qr" | "words") => {
    if (state.kind === "unsupported") throw new SyncError("unavailable");
    await rotation?.catch(() => undefined);
    if (readNextSecret(kv)) throw new SyncError("code_unconfirmed", "The new sync code isn't confirmed yet.");
    const existing = readSecret(kv);
    if (existing && sameBytes(existing, secret)) {
      if (!api) await activate();
      return;
    }
    // A different code: this device's old sync state means nothing to the new account.
    if (existing) {
      clearSyncState(kv);
      owed = [];
    }
    writeSecret(kv, secret);
    readDeviceId(kv, newId);
    // A brand-new code has no supporter status yet: don't ask the server for menus it can't have.
    if (how === "new") writeAccount(kv, parseAccount({ status: "none" }));
    track("sync_enabled", { how });
    if (method) track("device_paired", { method });
    await activate();
  };

  /** Pulls until caught up, with a loop of its own (SY-8 needs every synced menu here first). */
  const catchUp = async (current: SyncApi, currentKeys: SyncKeys) => {
    const gen = generation;
    const send = transport(currentKeys, gen);
    const holder: Holder = { loop: { ...newLoop(), pullWanted: true } };
    const io = engineIO(holder, gen);
    for (let rounds = 0; rounds < 10_000; rounds++) {
      const failures = holder.loop.failures;
      const { wait } = await syncStep(io.get, io.set, send, now, ctx);
      if (holder.loop.failures > failures) throw new SyncError(failing ? "offline" : "failed");
      if (!holder.loop.pulling && !holder.loop.pullWanted && wait !== 0) return;
    }
    throw new SyncError("failed");
  };

  // ---- actions ----------------------------------------------------------------

  const actions: SyncActions = {
    turnOn: async () => {
      if (syncIsOn(kv) && api) return;
      await enable(newSyncSecret(), "new");
    },

    restore: async (words: string) => {
      const secret = await parseSyncCode(words);
      await enable(secret, "restored", "words");
    },

    joinPairing: async (key: Uint8Array) => {
      if (state.kind === "unsupported") throw new SyncError("unavailable");
      let blob: string;
      try {
        blob = await readPairing(await pairingIdForKey(key), apiOptions);
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) throw new SyncError("pairing_not_found");
        if (error instanceof ApiError && error.status === 410) {
          throw new SyncError(error.code === "used" ? "pairing_used" : "pairing_expired");
        }
        throw toSyncError(error);
      }
      let secret: Uint8Array;
      try {
        secret = await openPairing(key, blob);
      } catch {
        throw new SyncError("pairing_unreadable");
      }
      await enable(secret, "restored", "qr");
    },

    syncCode: async () => {
      const secret = readSecret(kv);
      if (!secret) throw new SyncError("unavailable", "Sync is off.");
      try {
        return await secretToWords(secret);
      } finally {
        secret.fill(0);
      }
    },

    offerPairing: async (): Promise<PairingOffer> => {
      const on = requireOn();
      const secret = readSecret(kv);
      if (!secret) throw new SyncError("unavailable");
      const pairing = await createPairing(secret);
      secret.fill(0);
      try {
        const expiresAt = await on.api.pair(pairing.id, pairing.blob);
        return { link: pairingLink(origin, pairing.key), expiresAt };
      } catch (error) {
        throw toSyncError(error);
      }
    },

    turnOff: async () => {
      // Never in the middle of a code replacement: its outcome decides which code is live.
      await rotation?.catch(() => undefined);
      if (readNextSecret(kv)) {
        throw new SyncError("code_unconfirmed", "The new sync code isn't confirmed yet. Try again when you're online.");
      }
      bump();
      keys = null;
      api = null;
      main = null;
      owed = [];
      poke();
      clearSyncState(kv);
      publish({ kind: "off" });
    },

    replaceCode: async () => {
      const on = requireOn();
      if (rotation || readNextSecret(kv)) throw new SyncError("code_unconfirmed", "A new sync code is already being made.");
      const run = (async () => {
        // Stop the loop: nothing is pushed under the old code from here.
        bump();
        poke();
        let secret: Uint8Array | null = null;
        try {
          await catchUp(on.api, on.keys);
          secret = newSyncSecret();
          const next = await deriveKeys(secret);
          // Kept until the server's answer is known: if the answer is lost, the account
          // may already be under the new code, and forgetting it would lose the account.
          // Other tabs see it and pause their syncing.
          const sent = now();
          writeNextSecret(kv, secret, sent, sent);
          try {
            await on.api.rotate(next);
          } catch (error) {
            // Only a plain refusal (4xx) means nothing moved. No answer, a 5xx, or an
            // answer that can't be read: check the new account.
            const refused = error instanceof ApiError && error.status >= 400 && error.status < 500;
            if (refused) {
              clearNextSecret(kv);
              throw toSyncError(error);
            }
            const outcome = await rotationOutcome(next, sent);
            if (outcome !== "moved") {
              if (outcome === "not_moved") clearNextSecret(kv);
              // Unknown: the new code stays kept, and checking again settles it. This tab
              // is done with it, so any tab may check from now on (at 0).
              else writeNextSecret(kv, secret, 0, sent);
              throw new SyncError(
                outcome === "not_moved" ? "offline" : "code_unconfirmed",
                outcome === "not_moved" ? "offline" : "The new sync code isn't confirmed yet. Try again when you're online."
              );
            }
          }
          adoptNewCode(secret);
        } finally {
          secret?.fill(0);
        }
      })();
      rotation = run;
      try {
        await run;
      } finally {
        rotation = null;
        // The new code if it was kept; otherwise the old one, as before.
        await activate();
      }
    },

    deleteSyncedMenus: async () => {
      await rotation?.catch(() => undefined);
      if (readNextSecret(kv)) throw new SyncError("code_unconfirmed", "The new sync code isn't confirmed yet.");
      const on = requireOn();
      try {
        await on.api.deleteMenus();
      } catch (error) {
        throw toSyncError(error);
      }
      await actions.turnOff();
    },

    deleteSyncedData: async () => {
      await rotation?.catch(() => undefined);
      if (readNextSecret(kv)) throw new SyncError("code_unconfirmed", "The new sync code isn't confirmed yet.");
      const on = requireOn();
      try {
        await on.api.deleteAccount();
      } catch (error) {
        throw toSyncError(error);
      }
      await actions.turnOff();
    },

    checkout: async (plan: CheckoutPlan) => {
      if (!syncIsOn(kv) || !api) await actions.turnOn();
      const on = requireOn();
      try {
        return await on.api.checkout(plan);
      } catch (error) {
        throw toSyncError(error);
      }
    },

    manageSubscription: async () => {
      const on = requireOn();
      try {
        return await on.api.portal();
      } catch (error) {
        throw toSyncError(error);
      }
    },

    refreshAccount,

    syncNow: () => {
      if (!syncIsOn(kv)) return;
      if (main) return pullNow(true);
      requestLead();
      try {
        kv.setItem(POKE_KEY, String(now())); // the syncing tab hears it as a storage event
      } catch {
        // Storage is full; the syncing tab pulls on its own schedule.
      }
    },
  };

  // ---- page events ------------------------------------------------------------

  const visibilityChanged = () => {
    if (rotationPending && isVisible()) return void activate();
    if (!api) return;
    if (isVisible()) {
      if (main) pullNow(true);
      else requestLead();
      if (now() - accountCheckedAt > ACCOUNT_CHECK_MS) void refreshAccount();
    } else if (main) {
      // Leaving: send what's waiting now, with keepalive (SY-31).
      main.loop = { ...main.loop, pushAt: now() };
      poke();
    }
  };

  const storageChanged = (key: string | null) => {
    if (key === null || key === SYNC_KEY.code) {
      // Turned on, off or replaced in another tab.
      const secret = readSecret(kv);
      if (!secret) {
        // Even while keys are still being made: that activation must not finish.
        bump();
        keys = null;
        api = null;
        main = null;
        poke();
        ready = true;
        publish({ kind: "off" });
      } else {
        void activate();
      }
      return;
    }
    if (key === POKE_KEY) return pullNow(true);
    // Another tab started or finished replacing the code: pause, or carry on (SY-8).
    if (key === SYNC_KEY.nextCode) return void activate();
    // Another tab heard about the account (say, supporter status arrived): look again now.
    if (key === SYNC_KEY.status) poke();
    if (key.startsWith(SYNC_MENU_PREFIX)) pushSoon();
    if (key.startsWith("sync:")) publish();
  };

  return {
    ...actions,
    ...local.hooks,

    start: async () => {
      if (started) return;
      started = true;
      const token = ++startToken;
      const ok = await supported();
      // Stopped (and maybe started again) meanwhile: that start carries on, not this one.
      if (token !== startToken) return;
      if (!ok) {
        publish({ kind: "unsupported" });
        return;
      }
      unsubscribe = [
        onVisibilityChange(visibilityChanged),
        onStorage(storageChanged),
        // A save or deletion in this tab: push it soon (SY-31), and update the screens.
        local.onLocalChange(() => {
          if (main) pushSoon();
          else requestLead();
          publish();
        }),
      ];
      await activate();
    },

    stop: () => {
      startToken++;
      leadPending = false;
      bump();
      poke();
      for (const off of unsubscribe) off();
      unsubscribe = [];
      started = false;
    },

    getState: () => state,

    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    authorizer: () => (api ? api.authorize : null),
  };
};
