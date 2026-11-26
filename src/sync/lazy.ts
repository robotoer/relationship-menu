/**
 * Supporter sync for the app, without making everyone download it (spec SY-1's
 * rule for the word list, applied to all of sync). The save hooks and sync's
 * stored state are here at once (hooks.ts), so saves are recorded and the heart
 * shows without waiting. The rest (runtime.ts: keys, encryption, the API and the
 * loop) is a separate chunk: loaded straight away when sync is on in this
 * browser, otherwise once the page is idle, or as soon as a screen needs it.
 */

import { SyncError, SyncState } from "./context";
import { createLocalSync, readSyncState } from "./hooks";
import { syncIsOn } from "./local-store";
import type { MergeContext } from "./merge";
import type { RuntimeOptions, SyncRuntime } from "./runtime";
import type { KeyValueStore } from "../menu-store";
import { newMenuId } from "../menu-id";

/** How long after start to fetch the runtime when sync is off. */
const IDLE_LOAD_MS = 3_000;

const whenIdle = (task: () => void) => {
  const idle = (globalThis as { requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => void })
    .requestIdleCallback;
  setTimeout(() => (idle ? idle(task, { timeout: 10_000 }) : task()), IDLE_LOAD_MS);
};

/**
 * Sync when this browser won't let the page use its storage at all (some privacy
 * settings): unavailable, and every save just happens as before.
 */
const unavailableRuntime = (): SyncRuntime => {
  const state: SyncState = { kind: "unsupported" };
  const fail = () => Promise.reject(new SyncError("unavailable", "Sync needs this browser's storage."));
  return {
    saved: (_doc, _startedFrom, _previous, write) => {
      write?.();
      return null;
    },
    deleted: () => undefined,
    revisionOf: () => null,
    onMenusChanged: () => () => undefined,
    start: async () => undefined,
    stop: () => undefined,
    getState: () => state,
    subscribe: () => () => undefined,
    authorizer: () => null,
    turnOn: fail,
    restore: fail,
    joinPairing: fail,
    syncCode: fail,
    offerPairing: fail,
    turnOff: fail,
    replaceCode: fail,
    deleteSyncedData: fail,
    checkout: fail,
    manageSubscription: fail,
    refreshAccount: async () => null,
    syncNow: () => undefined,
  };
};

export const createLazySyncRuntime = (
  options: Omit<RuntimeOptions, "local"> & { load?: () => Promise<typeof import("./runtime")> } = {}
): SyncRuntime => {
  let kv: KeyValueStore;
  // Until the runtime is ready: what storage says (so a supporter's heart is there at once).
  let early: SyncState;
  try {
    kv = options.kv ?? globalThis.localStorage;
    early = readSyncState(kv);
  } catch {
    // The browser blocks storage: the app still runs, without sync.
    return unavailableRuntime();
  }
  const now = options.now ?? Date.now;
  const newId = options.newId ?? newMenuId;
  const ctx: MergeContext = { newMenuId: newId, newEditId: newId };
  const local = createLocalSync({ kv, now, ctx });
  const load = options.load ?? (() => import("./runtime"));

  let runtime: SyncRuntime | null = null;
  let loading: Promise<SyncRuntime> | null = null;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };

  let started = false;
  /** Bumps on stop: an idle load scheduled before it doesn't happen. */
  let attempt = 0;

  /**
   * Loads and starts the runtime, once at a time. If that fails (offline while
   * fetching the chunk, say), the next call tries again.
   */
  const ready = (): Promise<SyncRuntime> => {
    if (loading) return loading;
    const pending = (async () => {
      const module = await load();
      if (!runtime) {
        runtime = module.createSyncRuntime({ ...options, kv, now, newId, local });
        runtime.subscribe(notify);
      }
      const r = runtime;
      try {
        await r.start();
      } catch (error) {
        r.stop(); // so the next try starts it afresh
        throw error;
      }
      notify();
      return r;
    })();
    loading = pending;
    pending.catch(() => {
      if (loading === pending) loading = null;
    });
    return pending;
  };

  /** The runtime's state once it has one; before that, the early one. */
  const getState = (): SyncState => {
    const current = runtime?.getState();
    return current && current.kind !== "loading" ? current : early;
  };

  const later =
    <K extends keyof SyncRuntime>(key: K) =>
    async (...args: Parameters<Extract<SyncRuntime[K], (...a: never[]) => unknown>>) => {
      const r = await ready();
      return (r[key] as (...a: unknown[]) => unknown)(...args);
    };

  return {
    ...local.hooks,

    start: async () => {
      if (started) return;
      started = true;
      const at = attempt;
      if (syncIsOn(kv)) await ready();
      else
        whenIdle(() => {
          if (at === attempt && started) void ready().catch(() => undefined);
        });
    },
    stop: () => {
      attempt++;
      started = false;
      runtime?.stop();
      // A later start (or action) starts the runtime again.
      loading = null;
    },
    getState,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    authorizer: () => runtime?.authorizer() ?? null,

    turnOn: later("turnOn") as SyncRuntime["turnOn"],
    restore: later("restore") as SyncRuntime["restore"],
    joinPairing: later("joinPairing") as SyncRuntime["joinPairing"],
    syncCode: later("syncCode") as SyncRuntime["syncCode"],
    offerPairing: later("offerPairing") as SyncRuntime["offerPairing"],
    turnOff: later("turnOff") as SyncRuntime["turnOff"],
    replaceCode: later("replaceCode") as SyncRuntime["replaceCode"],
    deleteSyncedData: later("deleteSyncedData") as SyncRuntime["deleteSyncedData"],
    checkout: later("checkout") as SyncRuntime["checkout"],
    manageSubscription: later("manageSubscription") as SyncRuntime["manageSubscription"],
    refreshAccount: later("refreshAccount") as SyncRuntime["refreshAccount"],
    syncNow: () => {
      if (runtime) runtime.syncNow();
      else void ready().then((r) => r.syncNow(), () => undefined);
    },
  };
};
