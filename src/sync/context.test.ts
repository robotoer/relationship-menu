import { NO_SYNC, SyncError, isSupporter } from "./context";
import { fakeAccount, fakeSync } from "./fake-sync";

describe("SY-71: who counts as a supporter (the heart)", () => {
  test.each(["active", "past_due", "lifetime"] as const)("%s does", (status) => {
    expect(isSupporter({ kind: "on", account: fakeAccount({ status }), pending: 0, lastSyncedAt: null, notices: [], unreadable: 0 })).toBe(true);
  });

  test.each(["none", "lapsed"] as const)("%s doesn't", (status) => {
    expect(isSupporter({ kind: "on", account: fakeAccount({ status }), pending: 0, lastSyncedAt: null, notices: [], unreadable: 0 })).toBe(false);
  });

  test("nor does a device whose status the server hasn't reported yet, or with sync off", () => {
    expect(isSupporter({ kind: "on", account: null, pending: 0, lastSyncedAt: null, notices: [], unreadable: 0 })).toBe(false);
    expect(isSupporter({ kind: "off" })).toBe(false);
    expect(isSupporter({ kind: "unsupported" })).toBe(false);
    expect(isSupporter({ kind: "loading" })).toBe(false);
  });
});

describe("SY-70: without the sync runtime, the app works and sync is just off", () => {
  test("state is off, and actions reject with a SyncError instead of throwing synchronously", async () => {
    expect(NO_SYNC.state).toEqual({ kind: "off" });
    await expect(NO_SYNC.turnOn()).rejects.toBeInstanceOf(SyncError);
    await expect(NO_SYNC.checkout("supporter_12_yearly")).rejects.toMatchObject({ reason: "unavailable" });
    await expect(NO_SYNC.refreshAccount()).resolves.toBeNull();
    expect(() => NO_SYNC.syncNow()).not.toThrow();
  });
});

describe("the fake used by screen tests", () => {
  test("records calls and takes overrides", async () => {
    const sync = fakeSync({ checkout: async () => "https://example.test/pay" });
    await expect(sync.checkout("supporter_30_lifetime")).resolves.toBe("https://example.test/pay");
    expect(sync.checkout).toHaveBeenCalledWith("supporter_30_lifetime");
    await expect(sync.syncCode()).resolves.toHaveLength(24);
  });
});
