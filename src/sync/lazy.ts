/**
 * Supporter sync for the app, without making everyone download it (spec SY-1's
 * rule for the word list, applied to all of sync). The save hooks and sync's
 * stored state are here at once (hooks.ts), so saves are recorded and the heart
 * shows without waiting. The rest (runtime.ts: keys, encryption, the API and the
 * loop) is a separate chunk: loaded straight away when sync is on in this
 * browser, otherwise once the page is idle, or as soon as a screen needs it.
 */

import type { SyncState } from "./context";
import { createLocalSync, readSyncState } from "./hooks";
import { syncIsOn } from "./local-store";
import type { MergeContext } from "./merge";
import type { RuntimeOptions, SyncRuntime } from "./runtime";
import { newMenuId } from "../menu-id";

/** How long after start to fetch the runtime when sync is off. */
const IDLE_LOAD_MS = 3_000;

const whenIdle = (task: () => void) => {
  const idle = (globalThis as { requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => void })
    .requestIdleCallback;
  setTimeout(() => (idle ? idle(task, { timeout: 10_000 }) : task()), IDLE_LOAD_MS);
};

export const createLazySyncRuntime = (
  options: Omit<RuntimeOptions, "local"> & { load?: () => Promise<typeof import("./runtime")> } = {}
): SyncRuntime => {
  const kv = options.kv ?? globalThis.localStorage;
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

  // Until the runtime is ready: what storage says (so a supporter's heart is there at once).
  const early: SyncState = readSyncState(kv);
  let started = false;

  const ready = (): Promise<SyncRuntime> =>
    (loading ??= load().then(async (module) => {
      const r = module.createSyncRuntime({ ...options, kv, now, newId, local });
      r.subscribe(notify);
      runtime = r;
      await r.start();
      notify();
      return r;
    }));

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
      if (syncIsOn(kv)) await ready();
      else whenIdle(() => void ready().catch(() => undefined));
    },
    stop: () => runtime?.stop(),
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
