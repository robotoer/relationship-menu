/**
 * A stand-in for the sync runtime, for testing screens (sync settings, pairing,
 * Support, the heart) without keys, storage or a server. Pass a `state` and any
 * actions to override; the rest resolve with harmless values. Each action is a
 * `vi.fn`, so tests can check what was called.
 *
 *   const sync = fakeSync({ state: { kind: "off" } });
 *   render(<FakeSyncProvider value={sync}><SyncSettings /></FakeSyncProvider>);
 *   await user.click(screen.getByRole("button", { name: "Turn on sync" }));
 *   expect(sync.turnOn).toHaveBeenCalled();
 */

import React from "react";
import { vi, type Mock } from "vitest";
import { SyncAccount, SyncActions, SyncContext, SyncContextValue, SyncState } from "./context";

type Mocked<T> = { [K in keyof T]: T[K] extends (...args: infer A) => infer R ? Mock<(...args: A) => R> : T[K] };
export type FakeSync = { state: SyncState } & Mocked<SyncActions>;

/** An account with sensible defaults; pass what the test cares about. */
export const fakeAccount = (overrides: Partial<SyncAccount> = {}): SyncAccount => ({
  status: "active",
  plan: "supporter_12_yearly",
  renewsAt: Date.UTC(2027, 10, 25),
  readOnly: false,
  lapsedAt: null,
  purgeAt: null,
  purgeSoon: false,
  limits: { menus: 500, menuBytes: 65536, totalBytes: 4 * 1024 * 1024 },
  usage: { menus: 3, bytes: 3156 },
  ...overrides,
});

/** The 24 words of the frozen test vector's all-zero secret (BIP-39). */
const TEST_WORDS = [...Array(23).fill("abandon"), "art"];

export const fakeSync = (
  overrides: { state?: SyncState } & Partial<{ [K in keyof SyncActions]: SyncActions[K] }> = {}
): FakeSync => {
  const { state = { kind: "off" }, ...actions } = overrides;
  const defaults: SyncActions = {
    turnOn: async () => {},
    restore: async () => {},
    joinPairing: async () => {},
    syncCode: async () => [...TEST_WORDS],
    offerPairing: async () => ({ link: "http://localhost/pair#test-key", expiresAt: Date.now() + 10 * 60_000 }),
    turnOff: async () => {},
    replaceCode: async () => {},
    deleteSyncedData: async () => {},
    checkout: async () => "https://checkout.stripe.test/session",
    manageSubscription: async () => "https://billing.stripe.test/session",
    refreshAccount: async () => (state.kind === "on" ? state.account : null),
    syncNow: () => {},
  };
  const merged = { ...defaults, ...actions } as SyncActions;
  const mocked = Object.fromEntries(Object.entries(merged).map(([k, f]) => [k, vi.fn(f)])) as Mocked<SyncActions>;
  return { state, ...mocked };
};

export const FakeSyncProvider = ({ value, children }: { value: SyncContextValue; children: React.ReactNode }) => (
  <SyncContext.Provider value={value}>{children}</SyncContext.Provider>
);
