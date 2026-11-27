import React, { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from "react";
import { SyncContext, SyncContextValue } from "../sync/context";
import type { SyncRuntime } from "../sync/runtime";

const RuntimeContext = createContext<SyncRuntime | null>(null);

/**
 * Gives the app supporter sync (`useSync()`, src/sync/context.ts), backed by
 * `runtime`. It starts the runtime once mounted; the runtime keeps running for
 * the page's lifetime.
 */
export const SyncProvider = ({ runtime, children }: { runtime: SyncRuntime; children: React.ReactNode }) => {
  const state = useSyncExternalStore(runtime.subscribe, runtime.getState, runtime.getState);

  useEffect(() => {
    runtime.start().catch((e) => console.error("Sync couldn't start:", e instanceof Error ? e.name : "error"));
  }, [runtime]);

  const value: SyncContextValue = useMemo(
    () => ({
      state,
      turnOn: runtime.turnOn,
      restore: runtime.restore,
      joinPairing: runtime.joinPairing,
      syncCode: runtime.syncCode,
      offerPairing: runtime.offerPairing,
      turnOff: runtime.turnOff,
      replaceCode: runtime.replaceCode,
      deleteSyncedMenus: runtime.deleteSyncedMenus,
      deleteSyncedData: runtime.deleteSyncedData,
      checkout: runtime.checkout,
      manageSubscription: runtime.manageSubscription,
      refreshAccount: runtime.refreshAccount,
      syncNow: runtime.syncNow,
    }),
    [runtime, state]
  );

  return (
    <RuntimeContext.Provider value={runtime}>
      <SyncContext.Provider value={value}>{children}</SyncContext.Provider>
    </RuntimeContext.Provider>
  );
};

/** The runtime itself, for wiring that isn't a screen (the AI coach's signer). Null outside a SyncProvider. */
export const useSyncRuntime = (): SyncRuntime | null => useContext(RuntimeContext);
