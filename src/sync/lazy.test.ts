import { isSupporter } from "./context";
import { fakeAccount } from "./fake-sync";
import { createLazySyncRuntime } from "./lazy";
import { writeAccount, writeSecret } from "./local-store";
import type { SyncRuntime } from "./runtime";

/** A stand-in for runtime.ts, recording when it's loaded. */
const fakeModule = () => {
  const calls: string[] = [];
  const runtime = {
    start: async () => void calls.push("start"),
    stop: () => undefined,
    getState: () => ({ kind: "off" as const }),
    subscribe: () => () => undefined,
    authorizer: () => null,
    turnOn: async () => void calls.push("turnOn"),
    syncNow: () => void calls.push("syncNow"),
  } as unknown as SyncRuntime;
  const load = vi.fn(async () => ({ createSyncRuntime: () => runtime }) as unknown as typeof import("./runtime"));
  return { load, calls };
};

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe("SY-1: sync's code isn't part of the main download", () => {
  test("with sync off, the runtime loads only once the page is idle, or when an action needs it", async () => {
    const { load, calls } = fakeModule();
    const sync = createLazySyncRuntime({ load });
    await sync.start();
    expect(load).not.toHaveBeenCalled();
    expect(sync.getState()).toEqual({ kind: "off" });
    await sync.turnOn();
    expect(load).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(["start", "turnOn"]);
  });

  test("…and on its own after a few seconds", async () => {
    const { load } = fakeModule();
    const sync = createLazySyncRuntime({ load });
    await sync.start();
    await vi.advanceTimersByTimeAsync(3_500);
    expect(load).toHaveBeenCalledTimes(1);
  });

  test("with sync on, it loads at start", async () => {
    writeSecret(localStorage, new Uint8Array(32).fill(2));
    const { load, calls } = fakeModule();
    await createLazySyncRuntime({ load }).start();
    expect(load).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(["start"]);
  });
});

describe("loading the runtime, and stopping", () => {
  test("a load that failed (offline, say) is tried again by the next action", async () => {
    const { load: works, calls } = fakeModule();
    const load = vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch dynamically imported module")).mockImplementation(works);
    const sync = createLazySyncRuntime({ load });
    await expect(sync.turnOn()).rejects.toThrow();
    await sync.turnOn();
    expect(load).toHaveBeenCalledTimes(2);
    expect(calls).toEqual(["start", "turnOn"]);
  });

  test("stopping before the idle load cancels it, and starting again works", async () => {
    const { load } = fakeModule();
    const sync = createLazySyncRuntime({ load });
    await sync.start();
    sync.stop();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(load).not.toHaveBeenCalled();
    await sync.start();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(load).toHaveBeenCalledTimes(1);
  });

  test("when the browser blocks storage, the app still runs: sync is unavailable and saves just happen", async () => {
    const blocked = {
      get length(): number {
        throw new DOMException("denied", "SecurityError");
      },
      key: () => {
        throw new DOMException("denied", "SecurityError");
      },
      getItem: () => {
        throw new DOMException("denied", "SecurityError");
      },
      setItem: () => undefined,
      removeItem: () => undefined,
    };
    const sync = createLazySyncRuntime({ kv: blocked });
    expect(sync.getState()).toEqual({ kind: "unsupported" });
    const write = vi.fn();
    expect(sync.saved({ id: "x".repeat(22), title: "t", encoded: "e" }, null, undefined, write)).toBeNull();
    expect(write).toHaveBeenCalled();
    await expect(sync.turnOn()).rejects.toMatchObject({ reason: "unavailable" });
  });
});

describe("SY-71: a supporter's heart shows at once, before the runtime loads", () => {
  test("the state comes from what this browser last heard from the server", () => {
    writeSecret(localStorage, new Uint8Array(32).fill(2));
    writeAccount(localStorage, fakeAccount({ status: "lifetime" }));
    const sync = createLazySyncRuntime({ load: () => new Promise(() => undefined) });
    expect(isSupporter(sync.getState())).toBe(true);
  });
});
