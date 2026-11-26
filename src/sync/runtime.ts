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
import { Engine, Reply, Request, createEngine, retryDelayMs, syncStep, PUSH_DELAY_MS, PULL_EVERY_MS } from "./engine";
import { SyncKeys, deriveKeys } from "./keys";
import {
  RuntimeReport,
  clearSyncState,
  readAccount,
  readCursor,
  readDeviceId,
  readLocal,
  readReport,
  readSecret,
  readSkipped,
  resetMenuStates,
  syncIsOn,
  writeAccount,
  writeCursor,
  writeLocal,
  writeReport,
  writeSecret,
  writeSkipped,
  SYNC_KEY,
  SYNC_MENU_PREFIX,
} from "./local-store";
import { MergeContext, RemoteRecord, recordVersion } from "./merge";
import { LocalSync, SyncHooks, createLocalSync, pendingMenus, readSyncState } from "./hooks";
import { PairingError, createPairing, openPairing, pairingIdForKey, pairingLink } from "./pairing";
import { SyncRecordError, decryptRecord, encryptRecord } from "./records";
import { newSyncSecret, parseSyncCode, secretToWords } from "./sync-code";
import { syncSupported } from "./supported";

/** The Web Lock held by the tab that does the network part. */
export const SYNC_LOCK = "wantsandwonts-sync";
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
  /** Set once start has checked support and read the code: until then the state stays "loading". */
  let ready = false;

  // ---- state for the screens --------------------------------------------------

  const computeState = (): SyncState => (!ready || state.kind === "unsupported" ? state : readSyncState(kv));

  const publish = (next: SyncState = computeState()) => {
    if (JSON.stringify(next) === JSON.stringify(state)) return;
    state = next;
    for (const listener of listeners) listener();
  };

  /** The loop's own notices, for every tab (`sync:runtime`). */
  const report = (changes: Partial<RuntimeReport> & { add?: SyncNotice[]; remove?: SyncNotice[] } = {}) => {
    if (!syncIsOn(kv)) return;
    const current = readReport(kv);
    const notices = new Set<SyncNotice>(current.notices.filter((n) => n !== "offline" && n !== "storage_full" && n !== "menu_too_large"));
    for (const n of changes.add ?? []) notices.add(n);
    for (const n of changes.remove ?? []) notices.delete(n);
    if (failing) notices.add("offline");
    if (main?.loop.paused === "storage_full") notices.add("storage_full");
    if (readSkipped(kv).size > 0) notices.add("menu_too_large");
    writeReport(kv, {
      lastSyncedAt: changes.lastSyncedAt !== undefined ? changes.lastSyncedAt : current.lastSyncedAt,
      unreadable: changes.unreadable !== undefined ? changes.unreadable : current.unreadable,
      notices: [...notices].sort(),
    });
    publish();
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

  /** The engine as `syncStep` sees it: the holder's loop state, with menus and cursor read afresh. */
  const engineIO = (holder: Holder) => ({
    get: (): Engine => ({ ...holder.loop, local: local.currentLocal(), cursor: readCursor(kv) }),
    set: (engine: Engine) => {
      const { local: next, cursor, ...rest } = engine;
      holder.loop = rest;
      const before = readLocal(kv, readSkipped(kv));
      const changed = writeLocal(kv, before, next, now());
      if (cursor !== readCursor(kv)) writeCursor(kv, cursor);
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

  const replyFor = async (error: unknown, request: Request): Promise<Reply> => {
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
      skipMenu(request.id);
      return { kind: "failed", notApplied: true };
    }
    return { kind: "failed", notApplied: true };
  };

  const transport = (current: SyncApi, currentKeys: SyncKeys) => async (request: Request): Promise<Reply> => {
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
        return replyFor(error, request);
      }
    }
    let record: Uint8Array;
    try {
      record = await encryptRecord(currentKeys, recordVersion(request), { ...request.record, deviceId });
    } catch (error) {
      if (error instanceof SyncRecordError && error.problem === "too_large") {
        // Set aside until it changes (SY-23): the rest keep syncing.
        skipMenu(request.id);
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
      return replyFor(error, request);
    }
  };

  const mayPull = (account: SyncAccount | null) => account === null || account.status !== "none";

  const runLoop = async (gen: number) => {
    if (gen !== generation || !api || !keys) return;
    const send = transport(api, keys);
    const holder: Holder = { loop: newLoop() };
    const io = engineIO(holder);
    main = holder;
    let crashes = 0;
    try {
      while (gen === generation) {
        if (!mayPull(readAccount(kv))) {
          // Nothing to sync with until there's supporter status; refreshAccount wakes us.
          await sleep(PULL_EVERY_MS);
          continue;
        }
        if (!isVisible() && pendingMenus(kv) === 0) {
          // Pulls wait while the page is hidden (SY-32); showing it again wakes us.
          await sleep(null);
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
        if (step.events.moved.length > 0) local.emitMenus([], step.events.moved);
        const changes: Parameters<typeof report>[0] = {};
        if (step.events.unreadable > 0) {
          changes.unreadable = readReport(kv).unreadable + step.events.unreadable;
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

  const pullNow = () => {
    if (!main) return;
    main.loop = { ...main.loop, pullWanted: true };
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
    const gen = ++generation;
    keys = null;
    api = null;
    main = null;
    poke();
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
    publish();
    lead(() => runLoop(gen));
    void refreshAccount();
  };

  const requireOn = (): { api: SyncApi; keys: SyncKeys } => {
    if (state.kind === "unsupported" || !ready) throw new SyncError("unavailable");
    if (!api || !keys) throw new SyncError("unavailable", "Sync is off.");
    return { api, keys };
  };

  /** Turns sync on with `secret`, keeping this device's menus (SY-13). */
  const enable = async (secret: Uint8Array, how: "new" | "restored", method?: "qr" | "words") => {
    if (state.kind === "unsupported") throw new SyncError("unavailable");
    const existing = readSecret(kv);
    if (existing && sameBytes(existing, secret)) {
      if (!api) await activate();
      return;
    }
    // A different code: this device's old sync state means nothing to the new account.
    if (existing) clearSyncState(kv);
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
    const send = transport(current, currentKeys);
    const holder: Holder = { loop: { ...newLoop(), pullWanted: true } };
    const io = engineIO(holder);
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
      generation++;
      keys = null;
      api = null;
      main = null;
      poke();
      clearSyncState(kv);
      publish({ kind: "off" });
    },

    replaceCode: async () => {
      const on = requireOn();
      // Stop the loop: nothing is pushed under the old code from here.
      const gen = ++generation;
      poke();
      try {
        await catchUp(on.api, on.keys);
        const secret = newSyncSecret();
        const next = await deriveKeys(secret);
        try {
          await on.api.rotate(next);
        } catch (error) {
          secret.fill(0);
          throw toSyncError(error);
        }
        if (gen !== generation) return;
        writeSecret(kv, secret);
        secret.fill(0);
        // Every menu is new to the new account: push them all again.
        resetMenuStates(kv);
        report({ remove: ["code_replaced", "unreadable"], unreadable: 0 });
      } finally {
        if (gen === generation) await activate();
      }
    },

    deleteSyncedData: async () => {
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
      if (main) pullNow();
      else kv.setItem(POKE_KEY, String(now())); // the syncing tab hears it as a storage event
    },
  };

  // ---- page events ------------------------------------------------------------

  const visibilityChanged = () => {
    if (!api) return;
    if (isVisible()) {
      pullNow();
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
      const had = keys !== null;
      if (!secret && had) {
        generation++;
        keys = null;
        api = null;
        main = null;
        poke();
        publish({ kind: "off" });
      } else if (secret) {
        void activate();
      }
      return;
    }
    if (key === POKE_KEY) return pullNow();
    if (key.startsWith(SYNC_MENU_PREFIX)) pushSoon();
    if (key.startsWith("sync:")) publish();
  };

  return {
    ...actions,
    ...local.hooks,

    start: async () => {
      if (started) return;
      started = true;
      if (!(await supported())) {
        publish({ kind: "unsupported" });
        return;
      }
      unsubscribe = [
        onVisibilityChange(visibilityChanged),
        onStorage(storageChanged),
        // A save or deletion in this tab: push it soon (SY-31), and update the screens.
        local.onLocalChange(() => {
          pushSoon();
          publish();
        }),
      ];
      await activate();
    },

    stop: () => {
      generation++;
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
