/**
 * The sync runtime with whole devices: each has its own browser storage and
 * runtime, and they sync through an in-memory server that speaks the real wire
 * protocol and checks signatures (fake-server.ts).
 */
import type { KeyValueStore, SavedMenu } from "../menu-store";
import { menuKey, parseStoredMenu, readStoredMenus, writeStoredMenu } from "../menu-store";
import { deriveKeys } from "./keys";
import { createFakeServer, FakeServer } from "./fake-server";
import { readSecret, readState, writeSecret, SYNC_KEY } from "./local-store";
import { createSyncRuntime, SyncRuntime } from "./runtime";
import { SyncError } from "./context";
import { pairingKeyFromFragment } from "./pairing";
import { SyncCodeError } from "./sync-code";

/**
 * A real pause, taken before fake timers are installed. WebCrypto finishes on
 * Node's thread pool in real time, so each round must let real time pass, not
 * just yield (slower CI machines need it).
 */
const realSetTimeout = globalThis.setTimeout;
const realPause = (ms = 3) => new Promise<void>((resolve) => realSetTimeout(resolve, ms));

class MemoryStore implements KeyValueStore {
  private map = new Map<string, string>();
  /** Tabs sharing this store (see TabStore). */
  tabs = new Set<TabStore>();
  failWrites = false;
  /** Writes to these keys fail as if storage were full. */
  failKeys = new Set<string>();
  get length() {
    return this.map.size;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.failWrites || this.failKeys.has(key)) throw new DOMException("full", "QuotaExceededError");
    this.map.set(key, value);
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  keys() {
    return [...this.map.keys()];
  }
}

/** One tab's view of a browser's storage: the other tabs hear its writes as storage events, later. */
class TabStore implements KeyValueStore {
  listeners = new Set<(key: string) => void>();
  constructor(readonly shared: MemoryStore) {
    shared.tabs.add(this);
  }
  get length() {
    return this.shared.length;
  }
  key(i: number) {
    return this.shared.key(i);
  }
  getItem(key: string) {
    return this.shared.getItem(key);
  }
  // Like browsers: other tabs hear about a write only if it changed the value.
  setItem(key: string, value: string) {
    const before = this.shared.getItem(key);
    this.shared.setItem(key, value);
    if (before !== value) this.tell(key);
  }
  removeItem(key: string) {
    const before = this.shared.getItem(key);
    this.shared.removeItem(key);
    if (before !== null) this.tell(key);
  }
  keys() {
    return this.shared.keys();
  }
  private tell(key: string) {
    for (const tab of this.shared.tabs) {
      if (tab === this) continue;
      for (const listener of tab.listeners) queueMicrotask(() => listener(key));
    }
  }
}

type Tracked = { name: string; params: unknown };

const makeDevice = <K extends MemoryStore | TabStore = MemoryStore>(
  server: FakeServer,
  kv: K = new MemoryStore() as K,
  lead?: (task: () => Promise<void>) => void
) => {
  const tracked: Tracked[] = [];
  let visible = true;
  const visibilityListeners = new Set<() => void>();
  const runtime: SyncRuntime = createSyncRuntime({
    kv,
    api: { fetch: (input, init) => server.fetch(input, init) },
    origin: "http://app.test",
    supported: async () => true,
    lead: lead ?? ((task) => void task()),
    isVisible: () => visible,
    isOnline: () => server.isOnline(),
    onVisibilityChange: (l) => {
      visibilityListeners.add(l);
      return () => visibilityListeners.delete(l);
    },
    onStorage:
      kv instanceof TabStore
        ? (listener) => {
            kv.listeners.add(listener);
            return () => kv.listeners.delete(listener);
          }
        : () => () => {},
    track: ((name: string, params?: unknown) => tracked.push({ name, params })) as never,
  });
  const menus = () =>
    readStoredMenus(kv)
      .map((m) => m.doc)
      .sort((a, b) => a.title.localeCompare(b.title));
  /** A save as storage makes it (src/storage.ts): the write is handed to sync, which does it. */
  const save = (doc: SavedMenu, startedFrom: number | null = runtime.revisionOf(doc.id)) => {
    const previous = parseStoredMenu(menuKey(doc.id), kv.getItem(menuKey(doc.id)))?.doc;
    return runtime.saved(doc, startedFrom, previous, () => writeStoredMenu(kv, { doc, savedAt: Date.now() }));
  };
  const remove = (id: string) => {
    const previous = parseStoredMenu(menuKey(id), kv.getItem(menuKey(id)))?.doc;
    kv.removeItem(menuKey(id));
    runtime.deleted(id, previous);
  };
  const setVisible = (value: boolean) => {
    visible = value;
    for (const l of visibilityListeners) l();
  };
  return { kv, runtime, tracked, menus, save, remove, setVisible };
};

type Device = ReturnType<typeof makeDevice>;

/** Settles round by round until `done` holds (for steps whose real time varies with load). */
const settleUntil = async (done: () => boolean | Promise<boolean>, rounds = 200) => {
  for (let i = 0; i < rounds && !(await done()); i++) await settle(1);
};

/** Lets the runtime's (fake) timers and WebCrypto (real time) run. */
const settle = async (rounds = 25, step = 2_500) => {
  for (let i = 0; i < rounds; i++) {
    await vi.advanceTimersByTimeAsync(step);
    await realPause();
    await vi.advanceTimersByTimeAsync(0);
    await realPause();
  }
};

const accountIdOf = async (device: Device) => (await deriveKeys(readSecret(device.kv)!)).accountId;

const menu = (id: string, title: string, encoded = "e", updatedAt = Date.now()): SavedMenu => ({
  id,
  title,
  encoded,
  createdAt: updatedAt,
  updatedAt,
});
const ID = (n: number) => `menu${String(n).padStart(18, "0")}`;

/** Turns sync on with a new code and makes the account a supporter. */
const supporter = async (server: FakeServer, device: Device) => {
  await device.runtime.start();
  await device.runtime.turnOn();
  const accountId = await accountIdOf(device);
  server.setStatus(accountId, "active");
  await device.runtime.refreshAccount();
  return accountId;
};

let server: FakeServer;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.setSystemTime(Date.UTC(2026, 10, 26, 12));
  server = createFakeServer();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("SY-1, SY-9: turning sync on and off", () => {
  test("turning on makes a 24-word code; turning off removes it and all sync state, and keeps the menus", async () => {
    const a = makeDevice(server);
    a.save(menu(ID(1), "Ours"));
    await a.runtime.start();
    expect(a.runtime.getState()).toEqual({ kind: "off" });
    await a.runtime.turnOn();
    expect(a.runtime.getState()).toMatchObject({ kind: "on" });
    const words = await a.runtime.syncCode();
    expect(words).toHaveLength(24);
    expect(a.tracked).toEqual([{ name: "sync_enabled", params: { how: "new" } }]);
    // Turning on again changes nothing: the same code.
    await a.runtime.turnOn();
    expect(await a.runtime.syncCode()).toEqual(words);

    await a.runtime.turnOff();
    expect(a.runtime.getState()).toEqual({ kind: "off" });
    expect(a.kv.keys().filter((k) => k.startsWith("sync:"))).toEqual([]);
    expect(a.menus().map((m) => m.title)).toEqual(["Ours"]);
  });

  test("without supporter status, nothing is sent but the account check, and the screen says so", async () => {
    const a = makeDevice(server);
    a.save(menu(ID(1), "Ours"));
    await a.runtime.start();
    await a.runtime.turnOn();
    await settle(5);
    expect(server.requests.map((r) => `${r.method} ${r.path}`)).toEqual(["GET /v1/account"]);
    expect(server.requests.some((r) => r.path.startsWith("/v1/menus"))).toBe(false);
    expect(a.runtime.getState()).toMatchObject({ kind: "on", notices: ["not_supporter"], pending: 1 });
  });
});

describe("SY-71: starting up never shows sync as off when it's on", () => {
  test("the state stays \"loading\" until the code has been read (so the heart doesn't flicker)", async () => {
    const a = makeDevice(server);
    writeSecret(a.kv, new Uint8Array(32).fill(3));
    const seen: string[] = [];
    a.runtime.subscribe(() => seen.push(a.runtime.getState().kind));
    expect(a.runtime.getState().kind).toBe("loading");
    await a.runtime.start();
    expect(seen).not.toContain("off");
    expect(a.runtime.getState().kind).toBe("on");
  });
});

describe("SY-13, SY-31, SY-32: a second device restores, and both keep syncing", () => {
  test("restoring by words pulls every menu, keeps the device's own, and uploads it", async () => {
    const a = makeDevice(server);
    a.save(menu(ID(1), "From A"));
    await supporter(server, a);
    await settle();
    expect(a.runtime.getState()).toMatchObject({ kind: "on", pending: 0 });

    const b = makeDevice(server);
    b.save(menu(ID(2), "From B"));
    await b.runtime.start();
    await b.runtime.restore((await a.runtime.syncCode()).join(" "));
    await settle();
    expect(b.menus().map((m) => m.title)).toEqual(["From A", "From B"]);
    expect(b.tracked).toEqual([
      { name: "sync_enabled", params: { how: "restored" } },
      { name: "device_paired", params: { method: "words" } },
    ]);

    a.runtime.syncNow();
    await settle();
    expect(a.menus().map((m) => m.title)).toEqual(["From A", "From B"]);
  });

  test("an edit is pushed about 2 s after the save, and the other device gets it on its next pull", async () => {
    const a = makeDevice(server);
    a.save(menu(ID(1), "Ours", "v1"));
    await supporter(server, a);
    await settle();
    const b = makeDevice(server);
    await b.runtime.start();
    await b.runtime.restore((await a.runtime.syncCode()).join(" "));
    await settle();

    const before = server.requests.length;
    a.save(menu(ID(1), "Ours", "v2"));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(server.requests.slice(before).filter((r) => r.method === "PUT")).toEqual([]);
    await settle(3);
    expect(server.requests.slice(before).filter((r) => r.method === "PUT")).toHaveLength(1);

    b.runtime.syncNow();
    await settle();
    expect(b.menus()[0]).toMatchObject({ title: "Ours", encoded: "v2" });
  });

  test("a typed code with a wrong word is refused without changing anything", async () => {
    const b = makeDevice(server);
    await b.runtime.start();
    await expect(b.runtime.restore("abandon ".repeat(24))).rejects.toBeInstanceOf(SyncCodeError);
    expect(b.runtime.getState()).toEqual({ kind: "off" });
  });
});

describe("SY-10, SY-12: adding a device by pairing link", () => {
  test("the link joins the same account once; a second use is refused as used", async () => {
    const a = makeDevice(server);
    a.save(menu(ID(1), "Ours"));
    await supporter(server, a);
    await settle();
    const offer = await a.runtime.offerPairing();
    expect(offer.link).toMatch(/^http:\/\/app\.test\/pair#[A-Za-z0-9_-]{43}$/);
    const key = pairingKeyFromFragment(new URL(offer.link).hash)!;

    const b = makeDevice(server);
    await b.runtime.start();
    await b.runtime.joinPairing(key);
    await settle();
    expect(await accountIdOf(b)).toBe(await accountIdOf(a));
    expect(b.menus().map((m) => m.title)).toEqual(["Ours"]);
    expect(b.tracked.map((t) => t.params)).toEqual([{ how: "restored" }, { method: "qr" }]);

    const c = makeDevice(server);
    await c.runtime.start();
    await expect(c.runtime.joinPairing(key)).rejects.toMatchObject({ reason: "pairing_used" });
    expect(c.runtime.getState()).toEqual({ kind: "off" });
  });

  test("an expired link, an unknown one, and one whose key doesn't open the blob", async () => {
    const a = makeDevice(server);
    await supporter(server, a);
    const offer = await a.runtime.offerPairing();
    const key = pairingKeyFromFragment(new URL(offer.link).hash)!;
    const b = makeDevice(server);
    await b.runtime.start();
    await expect(b.runtime.joinPairing(new Uint8Array(32).fill(7))).rejects.toMatchObject({ reason: "pairing_not_found" });
    vi.setSystemTime(Date.now() + 11 * 60_000);
    await expect(b.runtime.joinPairing(key)).rejects.toMatchObject({ reason: "pairing_expired" });
  });

  test("offering needs supporter status", async () => {
    const a = makeDevice(server);
    await a.runtime.start();
    await a.runtime.turnOn();
    await expect(a.runtime.offerPairing()).rejects.toMatchObject({ reason: "not_supporter" });
  });
});

describe("SY-24, SY-35: both devices changed the same menu", () => {
  test("the newer edit keeps the menu; the other is kept as \"Title (from another device)\" on both", async () => {
    const a = makeDevice(server);
    a.save(menu(ID(1), "Ours", "base"));
    await supporter(server, a);
    await settle();
    const b = makeDevice(server);
    await b.runtime.start();
    await b.runtime.restore((await a.runtime.syncCode()).join(" "));
    await settle();

    server.setOnline(false);
    a.save(menu(ID(1), "Ours", "from A", Date.now()));
    vi.setSystemTime(Date.now() + 1000);
    b.save(menu(ID(1), "Ours", "from B", Date.now()));
    await settle(3);
    server.setOnline(true);
    a.runtime.syncNow();
    await settle();
    b.runtime.syncNow();
    await settle();
    a.runtime.syncNow();
    await settle();

    for (const d of [a, b]) {
      expect(d.menus().map((m) => [m.title, m.encoded])).toEqual([
        ["Ours", "from B"],
        ["Ours (from another device)", "from A"],
      ]);
    }
  });

  test("a save from an editor that didn't see a synced change keeps both versions (no silent overwrite)", async () => {
    const a = makeDevice(server);
    a.save(menu(ID(1), "Ours", "base"));
    await supporter(server, a);
    await settle();
    const b = makeDevice(server);
    await b.runtime.start();
    await b.runtime.restore((await a.runtime.syncCode()).join(" "));
    await settle();

    const loadedAt = b.runtime.revisionOf(ID(1));
    a.save(menu(ID(1), "Ours", "from A"));
    await settle();
    b.runtime.syncNow();
    await settle();
    expect(b.runtime.revisionOf(ID(1))).toBeGreaterThan(loadedAt!);
    // B's editor still had the old version open, and saves on top of it.
    b.save(menu(ID(1), "Ours", "from B's editor", Date.now() + 5000), loadedAt);
    expect(b.menus().map((m) => [m.title, m.encoded])).toEqual([
      ["Ours", "from B's editor"],
      ["Ours (from another device)", "from A"],
    ]);
  });
});

describe("SY-66: a lapsed account is read-only", () => {
  test("pulls still work, pushes are refused, and the screen says why", async () => {
    const a = makeDevice(server);
    a.save(menu(ID(1), "Ours"));
    const accountId = await supporter(server, a);
    await settle();
    server.setStatus(accountId, "lapsed");
    await a.runtime.refreshAccount();
    a.save(menu(ID(2), "New"));
    await settle();
    expect(server.liveMenuIds(accountId)).toEqual([ID(1)]);
    expect(a.runtime.getState()).toMatchObject({ kind: "on", notices: ["read_only"], pending: 1 });

    const b = makeDevice(server);
    await b.runtime.start();
    await b.runtime.restore((await a.runtime.syncCode()).join(" "));
    await settle();
    expect(b.menus().map((m) => m.title)).toEqual(["Ours"]);

    server.setStatus(accountId, "active");
    await a.runtime.refreshAccount();
    await settle();
    expect(server.liveMenuIds(accountId)).toEqual([ID(1), ID(2)]);
  });
});

describe("SY-8: replacing the sync code", () => {
  test("status moves to the new code, every menu is uploaded again, and other devices are told", async () => {
    const a = makeDevice(server);
    a.save(menu(ID(1), "Ours"));
    const oldId = await supporter(server, a);
    await settle();
    const b = makeDevice(server);
    await b.runtime.start();
    await b.runtime.restore((await a.runtime.syncCode()).join(" "));
    await settle();
    const oldWords = await a.runtime.syncCode();

    await a.runtime.replaceCode();
    await settle();
    const newId = await accountIdOf(a);
    expect(newId).not.toBe(oldId);
    expect(await a.runtime.syncCode()).not.toEqual(oldWords);
    expect(server.accounts.has(oldId)).toBe(false);
    expect(server.accounts.get(newId)?.status).toBe("active");
    expect(server.liveMenuIds(newId)).toEqual([ID(1)]);

    await b.runtime.refreshAccount();
    expect(b.runtime.getState()).toMatchObject({ kind: "on", notices: ["code_replaced"] });
    expect(b.menus().map((m) => m.title)).toEqual(["Ours"]);
  });

  test("another device enters the new code: it switches, keeps its menus, and nothing is duplicated (SY-13)", async () => {
    const a = makeDevice(server);
    a.save(menu(ID(1), "Ours"));
    await supporter(server, a);
    await settle();
    const b = makeDevice(server);
    await b.runtime.start();
    await b.runtime.restore((await a.runtime.syncCode()).join(" "));
    await settle();
    b.save(menu(ID(2), "Only on B"));

    await a.runtime.replaceCode();
    // The new words are there as soon as it resolves (SY-8 shows them at once).
    const newWords = await a.runtime.syncCode();
    await settle();
    await b.runtime.refreshAccount();
    expect(b.runtime.getState()).toMatchObject({ notices: ["code_replaced"] });

    // While sync is on with the old code, B switches to the new one.
    await b.runtime.restore(newWords.join(" "));
    await settle();
    expect(await accountIdOf(b)).toBe(await accountIdOf(a));
    expect(b.runtime.getState()).toMatchObject({ kind: "on", notices: [] });
    expect(b.menus().map((m) => m.title)).toEqual(["Only on B", "Ours"]);
    expect(server.liveMenuIds(await accountIdOf(a))).toEqual([ID(1), ID(2)]);
  });

  test("offline, nothing is replaced", async () => {
    const a = makeDevice(server);
    const oldId = await supporter(server, a);
    const words = await a.runtime.syncCode();
    server.setOnline(false);
    await expect(a.runtime.replaceCode()).rejects.toMatchObject({ reason: "offline" });
    expect(await a.runtime.syncCode()).toEqual(words);
    expect(server.accounts.has(oldId)).toBe(true);
  });
});

describe("SY-68: deleting synced data", () => {
  test("the account and its menus go from the server, sync turns off here, and local menus stay", async () => {
    const a = makeDevice(server);
    a.save(menu(ID(1), "Ours"));
    const accountId = await supporter(server, a);
    await settle();
    await a.runtime.deleteSyncedData();
    expect(server.accounts.has(accountId)).toBe(false);
    expect(a.runtime.getState()).toEqual({ kind: "off" });
    expect(a.menus().map((m) => m.title)).toEqual(["Ours"]);
  });
});

describe("SY-23, SY-26: a menu too large to sync", () => {
  test("is set aside with a notice; the others still sync; it's tried again once it changes", async () => {
    const a = makeDevice(server);
    const accountId = await supporter(server, a);
    a.save(menu(ID(1), "Huge", "x".repeat(70_000)));
    a.save(menu(ID(2), "Small"));
    await settle();
    expect(server.liveMenuIds(accountId)).toEqual([ID(2)]);
    expect(a.runtime.getState()).toMatchObject({ kind: "on", notices: ["menu_too_large"] });
    expect(a.menus().map((m) => m.title)).toEqual(["Huge", "Small"]);

    a.save(menu(ID(1), "Huge", "now small"));
    await settle();
    expect(server.liveMenuIds(accountId)).toEqual([ID(1), ID(2)]);
    expect(a.runtime.getState()).toMatchObject({ kind: "on", notices: [] });
  });
});

describe("SY-27, SY-31: offline and back", () => {
  test("changes wait on the device, the screen says it's offline, and they're sent once it's back", async () => {
    const a = makeDevice(server);
    const accountId = await supporter(server, a);
    await settle();
    server.setOnline(false);
    a.save(menu(ID(1), "Offline edit"));
    await settle(5);
    expect(a.runtime.getState()).toMatchObject({ kind: "on", notices: ["offline"], pending: 1 });
    server.setOnline(true);
    await settle(150, 3_000);
    expect(server.liveMenuIds(accountId)).toEqual([ID(1)]);
    expect(a.runtime.getState()).toMatchObject({ kind: "on", notices: [], pending: 0 });
  });

  test("leaving the page sends what's waiting at once, with keepalive", async () => {
    const a = makeDevice(server);
    const accountId = await supporter(server, a);
    await settle();
    a.save(menu(ID(1), "Quick edit"));
    a.setVisible(false);
    // Well before the usual 2 s push delay.
    for (let j = 0; j < 20; j++) {
      await vi.advanceTimersByTimeAsync(1);
      await realPause();
    }
    expect(server.liveMenuIds(accountId)).toEqual([ID(1)]);
  });
});

describe("SY-27: a first push whose reply was lost", () => {
  test("moves the menu to a fresh id (merge.ts applyUnknownCreate), says so, and nothing is duplicated", async () => {
    const a = makeDevice(server);
    const accountId = await supporter(server, a);
    await settle();
    const moves: { from: string; to: string }[] = [];
    a.runtime.onMenusChanged((_ids, moved) => moves.push(...moved));
    // The server applies the PUT, but the answer never arrives.
    const realFetch = server.fetch;
    let dropped = false;
    const fetchSpy = vi.spyOn(server, "fetch");
    fetchSpy.mockImplementation(async (input, init) => {
      const response = await realFetch(input, init);
      if (!dropped && init?.method === "PUT") {
        dropped = true;
        throw new TypeError("connection reset");
      }
      return response;
    });
    a.save(menu(ID(1), "Ours"));
    await settle();
    expect(moves).toHaveLength(1);
    expect(moves[0]!.from).toBe(ID(1));
    expect(a.menus().map((m) => [m.id, m.title])).toEqual([[moves[0]!.to, "Ours"]]);
    expect(server.liveMenuIds(accountId)).toEqual([moves[0]!.to]);
  });
});

describe("SY-30: sync never blocks or fails a save", () => {
  test("a save that storage can't hold together with its sync state fails, and changes nothing", async () => {
    const a = makeDevice(server);
    await supporter(server, a);
    a.save(menu(ID(1), "Ours", "e1"));
    const stateBefore = a.kv.getItem(`sync:menu:${ID(1)}`);
    a.kv.failKeys.add(`sync:menu:${ID(1)}`);
    expect(() => a.save(menu(ID(1), "Ours", "e2"))).toThrow();
    a.kv.failKeys.clear();
    expect(a.menus()[0]).toMatchObject({ encoded: "e1" });
    expect(a.kv.getItem(`sync:menu:${ID(1)}`)).toBe(stateBefore);
  });

  test("SY-35: a save whose conflict copy can't be stored fails, and the version it would have kept is still there", async () => {
    const a = makeDevice(server);
    a.save(menu(ID(1), "Ours", "base"));
    await supporter(server, a);
    await settle();
    const b = makeDevice(server);
    await b.runtime.start();
    await b.runtime.restore((await a.runtime.syncCode()).join(" "));
    await settle();
    const loadedAt = b.runtime.revisionOf(ID(1));
    a.save(menu(ID(1), "Ours", "from A"));
    await settle();
    b.runtime.syncNow();
    await settle();
    // B's editor saves over the version it never saw, but there's no room for the copy.
    const copyFails = (key: string) => key.startsWith("menu-v2:") && key !== menuKey(ID(1));
    const real = b.kv.setItem.bind(b.kv);
    vi.spyOn(b.kv, "setItem").mockImplementation((key, value) => {
      if (copyFails(key)) throw new DOMException("full", "QuotaExceededError");
      real(key, value);
    });
    expect(() => b.save(menu(ID(1), "Ours", "from B's editor", Date.now() + 5000), loadedAt)).toThrow();
    vi.mocked(b.kv.setItem).mockRestore();
    expect(b.menus().map((m) => [m.title, m.encoded])).toEqual([["Ours", "from A"]]);
  });

  test("with sync off, saves are untouched and have no revision", () => {
    const a = makeDevice(server);
    expect(a.save(menu(ID(1), "Ours"))).toBeNull();
    expect(a.kv.keys()).toEqual([menuKey(ID(1))]);
  });
});

describe("SY-6, SY-16, SY-80: what the server sees", () => {
  test("every call but the pairing read is signed, and no title, item or name appears in any request", async () => {
    const a = makeDevice(server);
    a.save({ ...menu(ID(1), "Secret title"), encoded: "secret-items", person: { name: "Secret name" } });
    await supporter(server, a);
    await settle();
    const offer = await a.runtime.offerPairing();
    const b = makeDevice(server);
    await b.runtime.start();
    await b.runtime.joinPairing(pairingKeyFromFragment(new URL(offer.link).hash)!);
    await settle();
    for (const r of server.requests) {
      expect(r.account !== null || r.path.startsWith("/v1/pair/")).toBe(true);
      expect(r.bodyText).not.toMatch(/Secret|secret-items/);
    }
    expect(server.requests.some((r) => r.method === "PUT")).toBe(true);
  });
});

describe("SY-75: sync analytics carry no ids, codes, words or links", () => {
  test("only the fixed parameters", async () => {
    const a = makeDevice(server);
    await supporter(server, a);
    const offer = await a.runtime.offerPairing();
    const b = makeDevice(server);
    await b.runtime.start();
    await b.runtime.joinPairing(pairingKeyFromFragment(new URL(offer.link).hash)!);
    const all = JSON.stringify([...a.tracked, ...b.tracked]);
    expect(all).toBe(
      JSON.stringify([
        { name: "sync_enabled", params: { how: "new" } },
        { name: "sync_enabled", params: { how: "restored" } },
        { name: "device_paired", params: { method: "qr" } },
      ])
    );
  });
});

/** A Web Lock: the first tab to ask holds it; the others wait their turn. */
const fakeLock = () => {
  let held = false;
  const queue: (() => Promise<void>)[] = [];
  const lead = (task: () => Promise<void>) => {
    if (held) return void queue.push(task);
    held = true;
    void task().finally(() => {
      held = false;
      const next = queue.shift();
      if (next) lead(next);
    });
  };
  return { lead, queue };
};

describe("SY-25: one tab syncs for the whole browser", () => {
  test("a save in a tab that isn't syncing is pushed by the one that is, woken by the storage event", async () => {
    const shared = new MemoryStore();
    const lock = fakeLock();
    const tab1 = makeDevice(server, new TabStore(shared), lock.lead);
    const tab2 = makeDevice(server, new TabStore(shared), lock.lead);
    await tab1.runtime.start();
    await tab1.runtime.turnOn();
    const accountId = await accountIdOf(tab1);
    server.setStatus(accountId, "active");
    await tab1.runtime.refreshAccount();
    await tab2.runtime.start();
    await settle();
    expect(lock.queue).toHaveLength(1); // tab 2 waits for the lock

    tab2.save(menu(ID(1), "Saved in tab 2"));
    // No "sync now": tab 1 hears the save and pushes it after the usual short delay.
    await settle(3);
    expect(server.liveMenuIds(accountId)).toEqual([ID(1)]);
    expect(readState(shared, ID(1))).toMatchObject({ dirty: false });
  });

  test("a syncing tab that goes into the background with nothing to send lets a visible tab take over", async () => {
    const shared = new MemoryStore();
    const lock = fakeLock();
    const tab1 = makeDevice(server, new TabStore(shared), lock.lead);
    const tab2 = makeDevice(server, new TabStore(shared), lock.lead);
    await tab1.runtime.start();
    await tab1.runtime.turnOn();
    const accountId = await accountIdOf(tab1);
    server.setStatus(accountId, "active");
    await tab1.runtime.refreshAccount();
    await tab2.runtime.start();
    await settle();

    // Another device adds a menu; tab 1 is hidden, tab 2 is the one in view.
    const other = makeDevice(server);
    await other.runtime.start();
    await other.runtime.restore((await tab1.runtime.syncCode()).join(" "));
    other.save(menu(ID(5), "From the phone"));
    await settle();
    tab1.setVisible(false);
    await settle();
    expect(lock.queue).toHaveLength(0); // tab 2 has the lock now
    tab2.runtime.syncNow();
    await settle();
    expect(tab2.menus().map((m) => m.title)).toEqual(["From the phone"]);
  });
});

describe("SY-8: the server's answer to a code replacement is lost", () => {
  /** The server applies the rotation, but its answer never arrives. */
  const loseRotationAnswer = (then?: () => void) => {
    const real = server.fetch;
    vi.spyOn(server, "fetch").mockImplementation(async (input, init) => {
      const response = await real(input, init);
      if (String(input).endsWith("/v1/account/rotate")) {
        then?.();
        throw new TypeError("connection reset");
      }
      return response;
    });
  };

  test("it did happen: the device keeps the new code, and with it the account", async () => {
    const a = makeDevice(server);
    a.save(menu(ID(1), "Ours"));
    const oldId = await supporter(server, a);
    await settle();
    loseRotationAnswer();
    await a.runtime.replaceCode();
    await settle();
    const newId = await accountIdOf(a);
    expect(newId).not.toBe(oldId);
    expect(server.accounts.get(newId)?.status).toBe("active");
    expect(server.liveMenuIds(newId)).toEqual([ID(1)]);
    expect(a.kv.getItem(SYNC_KEY.nextCode)).toBeNull();
  });

  test("still unknown (offline): the new code is kept and nothing syncs, until it can be checked", async () => {
    const a = makeDevice(server);
    a.save(menu(ID(1), "Ours"));
    const oldId = await supporter(server, a);
    await settle();
    loseRotationAnswer(() => server.setOnline(false));
    await expect(a.runtime.replaceCode()).rejects.toMatchObject({ reason: "code_unconfirmed" });
    expect(a.kv.getItem(SYNC_KEY.nextCode)).not.toBeNull();
    expect(a.runtime.getState()).toMatchObject({ kind: "on", notices: expect.arrayContaining(["offline"]) });
    // Until it's confirmed, nothing that depends on which code is live goes ahead.
    await expect(a.runtime.turnOff()).rejects.toMatchObject({ reason: "code_unconfirmed" });
    await expect(a.runtime.replaceCode()).rejects.toMatchObject({ reason: "code_unconfirmed" });

    server.setOnline(true);
    await settle(20); // it checks again every 30 s
    const newId = await accountIdOf(a);
    expect(newId).not.toBe(oldId);
    expect(server.accounts.has(oldId)).toBe(false);
    expect(server.liveMenuIds(newId)).toEqual([ID(1)]);
    expect(a.kv.getItem(SYNC_KEY.nextCode)).toBeNull();
  });

  test("an answer that can't be read counts as lost, not as a refusal", async () => {
    const a = makeDevice(server);
    a.save(menu(ID(1), "Ours"));
    const oldId = await supporter(server, a);
    await settle();
    const real = server.fetch;
    vi.spyOn(server, "fetch").mockImplementation(async (input, init) => {
      const response = await real(input, init);
      if (String(input).endsWith("/v1/account/rotate")) return new Response("{}", { status: 200 });
      return response;
    });
    await a.runtime.replaceCode();
    await settle();
    expect(await accountIdOf(a)).not.toBe(oldId);
    expect(server.liveMenuIds(await accountIdOf(a))).toEqual([ID(1)]);
  });

  test("a check that comes back without a status doesn't count as \"it didn't happen\"", async () => {
    const a = makeDevice(server);
    await supporter(server, a);
    await settle();
    const real = server.fetch;
    let blankChecks = true;
    vi.spyOn(server, "fetch").mockImplementation(async (input, init) => {
      const response = await real(input, init);
      if (String(input).endsWith("/v1/account/rotate")) throw new TypeError("connection reset");
      if (blankChecks && String(input).endsWith("/v1/account")) return new Response("{}", { status: 200 });
      return response;
    });
    await expect(a.runtime.replaceCode()).rejects.toMatchObject({ reason: "code_unconfirmed" });
    expect(a.kv.getItem(SYNC_KEY.nextCode)).not.toBeNull();
    blankChecks = false;
    await settle(20);
    expect(a.kv.getItem(SYNC_KEY.nextCode)).toBeNull();
    expect(server.accounts.get(await accountIdOf(a))?.status).toBe("active");
  });

  test("turning sync off waits for a replacement under way, and doesn't turn it back on", async () => {
    const a = makeDevice(server);
    await supporter(server, a);
    await settle();
    const replacing = a.runtime.replaceCode();
    const off = a.runtime.turnOff();
    await replacing;
    await off;
    await settle();
    expect(a.runtime.getState()).toEqual({ kind: "off" });
    expect(a.kv.keys().filter((k) => k.startsWith("sync:"))).toEqual([]);
  });

  test("another tab pauses its syncing while one tab replaces the code, and carries on with the new code", async () => {
    const shared = new MemoryStore();
    const lock = fakeLock();
    const tab1 = makeDevice(server, new TabStore(shared), lock.lead);
    const tab2 = makeDevice(server, new TabStore(shared), lock.lead);
    await tab1.runtime.start();
    await tab1.runtime.turnOn();
    const oldId = await accountIdOf(tab1);
    server.setStatus(oldId, "active");
    await tab1.runtime.refreshAccount();
    await tab2.runtime.start();
    await settle();
    // Tab 1 leads; tab 2 replaces the code, and tab 1 keeps saving meanwhile.
    const replacing = tab2.runtime.replaceCode();
    tab1.save(menu(ID(1), "Saved during the replacement"));
    for (let i = 0; i < 10; i++) {
      tab1.save(menu(ID(1), "Saved during the replacement", `edit ${i}`));
      await settle(1, 500);
    }
    await replacing;
    const newId = await accountIdOf(tab2);
    await settleUntil(async () => server.liveMenuIds(newId).length === 1 && (await accountIdOf(tab1)) === newId);
    // Once the replacement was under way (from its request on), nothing was sent to the
    // old account: requests are recorded in the order they were sent.
    const rotated = server.requests.findIndex((r) => r.path === "/v1/account/rotate");
    expect(rotated).toBeGreaterThan(-1);
    const afterwards = server.requests.slice(rotated + 1).filter((r) => r.account === oldId);
    expect(afterwards.filter((r) => r.method === "PUT" || r.method === "DELETE")).toEqual([]);
    expect(newId).not.toBe(oldId);
    expect(server.liveMenuIds(newId)).toEqual([ID(1)]);
    // And tab 1 carries on under the new code.
    expect(await accountIdOf(tab1)).toBe(newId);
  });

  test("a check made while the move may still be applied late doesn't count: the code is kept until it's settled", async () => {
    const a = makeDevice(server);
    a.save(menu(ID(1), "Ours"));
    const oldId = await supporter(server, a);
    await settle();
    // The connection drops, but the server applies the move a minute later.
    const real = server.fetch;
    vi.spyOn(server, "fetch").mockImplementation(async (input, init) => {
      if (String(input).endsWith("/v1/account/rotate")) {
        setTimeout(() => void real(input, init), 60_000);
        throw new TypeError("connection reset");
      }
      return real(input, init);
    });
    await expect(a.runtime.replaceCode()).rejects.toMatchObject({ reason: "code_unconfirmed" });
    // The new account doesn't exist yet: "not moved" for now, but the code is kept.
    expect(a.kv.getItem(SYNC_KEY.nextCode)).not.toBeNull();
    await settle(40); // the move lands after a minute; checks every 30 s
    const newId = await accountIdOf(a);
    expect(newId).not.toBe(oldId);
    expect(server.accounts.get(newId)?.status).toBe("active");
    expect(server.liveMenuIds(newId)).toEqual([ID(1)]);
  });

  test("and once it can no longer be applied, \"not moved\" is believed: the old code carries on", async () => {
    const a = makeDevice(server);
    a.save(menu(ID(1), "Ours"));
    const oldId = await supporter(server, a);
    await settle();
    const words = await a.runtime.syncCode();
    const real = server.fetch;
    vi.spyOn(server, "fetch").mockImplementation(async (input, init) => {
      if (String(input).endsWith("/v1/account/rotate")) throw new TypeError("never sent");
      return real(input, init);
    });
    await expect(a.runtime.replaceCode()).rejects.toMatchObject({ reason: "code_unconfirmed" });
    await settle(320); // past 12 minutes
    expect(a.kv.getItem(SYNC_KEY.nextCode)).toBeNull();
    expect(await a.runtime.syncCode()).toEqual(words);
    expect(server.accounts.get(oldId)?.status).toBe("active");
  });

  test("a move held up after it was accepted is refused by the server, so \"not moved\" after 12 minutes is safe", async () => {
    const a = makeDevice(server);
    a.save(menu(ID(1), "Ours"));
    const oldId = await supporter(server, a);
    await settle();
    const words = await a.runtime.syncCode();
    // The answer is lost, and the server is held up for 7 minutes before it would commit.
    server.delayRotationCommit(7 * 60_000);
    const real = server.fetch;
    vi.spyOn(server, "fetch").mockImplementation(async (input, init) => {
      if (String(input).endsWith("/v1/account/rotate")) {
        void real(input, init);
        throw new TypeError("connection reset");
      }
      return real(input, init);
    });
    await expect(a.runtime.replaceCode()).rejects.toMatchObject({ reason: "code_unconfirmed" });
    await settle(320); // past 12 minutes
    expect(a.kv.getItem(SYNC_KEY.nextCode)).toBeNull();
    expect(await a.runtime.syncCode()).toEqual(words);
    expect(server.accounts.get(oldId)?.status).toBe("active");
    expect(server.accounts.size).toBe(1); // the move never happened
  });

  test("a clear refusal: nothing moved, and the old code stays", async () => {
    const a = makeDevice(server);
    await supporter(server, a);
    const words = await a.runtime.syncCode();
    server.failNext((method, path) => method === "POST" && path === "/v1/account/rotate", 409);
    await expect(a.runtime.replaceCode()).rejects.toBeInstanceOf(SyncError);
    expect(await a.runtime.syncCode()).toEqual(words);
    expect(a.kv.getItem(SYNC_KEY.nextCode)).toBeNull();
  });
});

describe("SY-26: a menu set aside as too large is still merged and deleted properly", () => {
  const twoDevices = async () => {
    const a = makeDevice(server);
    a.save(menu(ID(1), "Ours", "small"));
    const accountId = await supporter(server, a);
    await settle();
    const b = makeDevice(server);
    await b.runtime.start();
    await b.runtime.restore((await a.runtime.syncCode()).join(" "));
    await settle();
    return { a, b, accountId };
  };

  test("deleting it still deletes it on the server", async () => {
    const { a, accountId } = await twoDevices();
    a.save(menu(ID(1), "Ours", "x".repeat(70_000)));
    await settle();
    expect(a.runtime.getState()).toMatchObject({ notices: ["menu_too_large"] });
    a.remove(ID(1));
    await settle();
    expect(server.liveMenuIds(accountId)).toEqual([]);
    expect(a.runtime.getState()).toMatchObject({ notices: [], pending: 0 });
  });

  test("a newer version from another device doesn't overwrite it: both are kept", async () => {
    const { a, b } = await twoDevices();
    a.save(menu(ID(1), "Ours", "x".repeat(70_000)));
    await settle();
    vi.setSystemTime(Date.now() + 1000);
    b.save(menu(ID(1), "Ours", "from B"));
    await settle();
    a.runtime.syncNow();
    await settle();
    expect(a.menus().map((m) => [m.title, m.encoded.length])).toEqual([
      ["Ours", "from B".length],
      ["Ours (from another device)", 70_000],
    ]);
  });
});

describe("SY-26: a late \"too large\" for an older version", () => {
  test("doesn't hold back the newer, smaller version saved meanwhile", async () => {
    const a = makeDevice(server);
    const accountId = await supporter(server, a);
    await settle();
    const real = server.fetch;
    let answered: () => void = () => undefined;
    let firstPut = true;
    vi.spyOn(server, "fetch").mockImplementation(async (input, init) => {
      if (firstPut && init?.method === "PUT") {
        firstPut = false;
        // While this upload is on its way, the menu is edited again.
        a.save(menu(ID(1), "Ours", "smaller now"));
        answered();
        return new Response(JSON.stringify({ error: "too_large" }), { status: 413 });
      }
      return real(input, init);
    });
    void answered;
    a.save(menu(ID(1), "Ours", "first version"));
    await settle();
    expect(server.liveMenuIds(accountId)).toEqual([ID(1)]);
    expect(a.runtime.getState()).toMatchObject({ notices: [] });
  });
});

describe("SY-25: a hidden tab that can't send anything gives up the lock", () => {
  test("even with changes waiting, if the account is read-only", async () => {
    const shared = new MemoryStore();
    const lock = fakeLock();
    const tab1 = makeDevice(server, new TabStore(shared), lock.lead);
    const tab2 = makeDevice(server, new TabStore(shared), lock.lead);
    await tab1.runtime.start();
    await tab1.runtime.turnOn();
    const accountId = await accountIdOf(tab1);
    server.setStatus(accountId, "lapsed");
    await tab1.runtime.refreshAccount();
    await tab2.runtime.start();
    tab1.save(menu(ID(1), "Waiting"));
    await settle();
    tab1.setVisible(false);
    await settle();
    expect(lock.queue).toHaveLength(0); // tab 2 has it
  });
});

describe("SY-32: a page that asks for more without moving on is refused", () => {
  test("so the tab never asks for the same page forever", async () => {
    const a = makeDevice(server);
    await supporter(server, a);
    await settle();
    const real = server.fetch;
    let pulls = 0;
    vi.spyOn(server, "fetch").mockImplementation(async (input, init) => {
      if (String(input).startsWith("/v1/menus?")) {
        pulls++;
        await real(input, init);
        const since = Number(new URL(String(input), "http://x").searchParams.get("since"));
        return new Response(JSON.stringify({ menus: [], next: since, more: true, resync: false }), { status: 200 });
      }
      return real(input, init);
    });
    a.runtime.syncNow();
    await settle(10, 1000);
    // Refused and retried with backoff, not asked again in a tight loop.
    expect(pulls).toBeLessThan(10);
  });
});

describe("SY-32: a garbled page of a full listing is refused, not taken as \"nothing there\"", () => {
  test("an empty-looking answer deletes nothing", async () => {
    const a = makeDevice(server);
    a.save(menu(ID(1), "Ours"));
    await supporter(server, a);
    await settle();
    a.kv.setItem(SYNC_KEY.cursor, "0"); // the next pull is a full listing
    const real = server.fetch;
    let garbled = false;
    vi.spyOn(server, "fetch").mockImplementation(async (input, init) => {
      if (!garbled && String(input).startsWith("/v1/menus?")) {
        garbled = true;
        await real(input, init);
        return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
      }
      return real(input, init);
    });
    a.runtime.syncNow();
    await settle();
    expect(garbled).toBe(true);
    expect(a.menus().map((m) => m.title)).toEqual(["Ours"]);
  });
});

describe("the code changing while a request is in flight", () => {
  test("SY-9: a pull that answers after sync was turned off writes nothing", async () => {
    const a = makeDevice(server);
    a.save(menu(ID(1), "Ours"));
    await supporter(server, a);
    await settle();
    let release: () => void = () => undefined;
    let arrived: () => void = () => undefined;
    const inFlight = new Promise<void>((r) => (arrived = r));
    const real = server.fetch;
    vi.spyOn(server, "fetch").mockImplementation(async (input, init) => {
      if (String(input).startsWith("/v1/menus?")) {
        const held = new Promise<void>((r) => (release = r));
        arrived();
        await held;
      }
      return real(input, init);
    });
    a.runtime.syncNow();
    // Only once the pull has really reached the server.
    while (!(await Promise.race([inFlight.then(() => true), realPause().then(() => false)]))) {
      await vi.advanceTimersByTimeAsync(100);
    }
    await a.runtime.turnOff();
    release();
    await settle(3);
    expect(a.kv.keys().filter((k) => k.startsWith("sync:"))).toEqual([]);
    expect(a.menus().map((m) => m.title)).toEqual(["Ours"]);
  });
});

describe("SY-17: what the status line couldn't store is written later", () => {
  test("an unreadable record found while storage was full still shows up afterwards", async () => {
    const a = makeDevice(server);
    a.save(menu(ID(1), "Ours"));
    const accountId = await supporter(server, a);
    await settle();
    // The server's copy is damaged (and served as a newer version).
    const account = server.accounts.get(accountId)!;
    const row = account.menus.get(ID(1))!;
    account.seq += 1;
    account.menus.set(ID(1), { ...row, version: row.version + 1, seq: account.seq, ciphertext: row.ciphertext.slice(0, -8) + "AAAAAAAA" });
    a.kv.failKeys.add(SYNC_KEY.runtime);
    a.runtime.syncNow();
    await settle();
    a.kv.failKeys.clear();
    a.runtime.syncNow();
    await settle();
    expect(a.runtime.getState()).toMatchObject({ kind: "on", unreadable: 1, notices: ["unreadable"] });
  });
});

describe("SY-17: however long the status line can't be stored", () => {
  test("an unreadable record isn't forgotten, even after well over a hundred failed writes", async () => {
    const a = makeDevice(server);
    a.save(menu(ID(1), "Ours"));
    const accountId = await supporter(server, a);
    await settle();
    const account = server.accounts.get(accountId)!;
    const row = account.menus.get(ID(1))!;
    account.seq += 1;
    account.menus.set(ID(1), { ...row, version: row.version + 1, seq: account.seq, ciphertext: row.ciphertext.slice(0, -8) + "AAAAAAAA" });
    a.kv.failKeys.add(SYNC_KEY.runtime);
    a.runtime.syncNow();
    await settle();
    // Many more rounds and saves, each failing to store the status line.
    for (let i = 0; i < 160; i++) {
      a.save(menu(ID(2), "Busy", `edit ${i}`));
      await settle(1, 500);
    }
    a.kv.failKeys.clear();
    a.runtime.syncNow();
    await settle();
    expect(a.runtime.getState()).toMatchObject({ kind: "on", unreadable: 1, notices: ["unreadable"] });
  });
});

describe("SY-31: sync keeps going when its own status can't be stored", () => {
  test("a full storage for the status line doesn't stop pushes", async () => {
    const a = makeDevice(server);
    const accountId = await supporter(server, a);
    await settle();
    a.kv.failKeys.add(SYNC_KEY.runtime);
    a.save(menu(ID(1), "Ours"));
    await settle();
    expect(server.liveMenuIds(accountId)).toEqual([ID(1)]);
  });

  test("\"sync now\" sends a waiting change at once, without the usual delay", async () => {
    const a = makeDevice(server);
    const accountId = await supporter(server, a);
    await settle();
    a.save(menu(ID(1), "Ours"));
    a.runtime.syncNow();
    for (let j = 0; j < 20; j++) {
      await vi.advanceTimersByTimeAsync(1);
      await realPause();
    }
    expect(server.liveMenuIds(accountId)).toEqual([ID(1)]);
  });
});

describe("SY-25: news from another tab", () => {
  test("supporter status heard in another tab wakes the syncing tab at once", async () => {
    const shared = new MemoryStore();
    const lock = fakeLock();
    const tab1 = makeDevice(server, new TabStore(shared), lock.lead);
    const tab2 = makeDevice(server, new TabStore(shared), lock.lead);
    await tab1.runtime.start();
    await tab1.runtime.turnOn();
    await tab2.runtime.start();
    tab1.save(menu(ID(1), "Waiting for support"));
    await settle(2);
    const accountId = await accountIdOf(tab1);
    server.setStatus(accountId, "active");
    // Tab 2 (back from Checkout, say) hears it; tab 1 is the one syncing.
    await tab2.runtime.refreshAccount();
    await settle(3); // well under the 5-minute wait
    expect(server.liveMenuIds(accountId)).toEqual([ID(1)]);
  });
});

describe("SY-33: a round that failed part-way still tells the editor", () => {
  test("when storing the cursor fails, the changed menu is announced once the round succeeds", async () => {
    const a = makeDevice(server);
    a.save(menu(ID(1), "Ours", "v1"));
    await supporter(server, a);
    await settle();
    const b = makeDevice(server);
    await b.runtime.start();
    await b.runtime.restore((await a.runtime.syncCode()).join(" "));
    await settle();
    const announced: string[] = [];
    b.runtime.onMenusChanged((ids) => announced.push(...ids));
    a.save(menu(ID(1), "Ours", "v2"));
    await settle();
    b.kv.failKeys.add(SYNC_KEY.cursor);
    b.runtime.syncNow();
    await settle(3);
    expect(b.menus()[0]).toMatchObject({ encoded: "v1" }); // all or nothing
    b.kv.failKeys.clear();
    await settle(10);
    b.runtime.syncNow();
    await settle();
    expect(b.menus()[0]).toMatchObject({ encoded: "v2" });
    expect(announced).toContain(ID(1));
  });
});

describe("SY-33: when a failed round can't even be undone", () => {
  test("the menus it left changed are announced at once", async () => {
    const a = makeDevice(server);
    a.save(menu(ID(1), "Ours", "v1"));
    await supporter(server, a);
    await settle();
    const b = makeDevice(server);
    await b.runtime.start();
    await b.runtime.restore((await a.runtime.syncCode()).join(" "));
    await settle();
    const announced: string[] = [];
    b.runtime.onMenusChanged((ids) => announced.push(...ids));
    a.save(menu(ID(1), "Ours", "v2"));
    await settle();
    // Storing the cursor fails, and at that moment storage fills up, so the menu and
    // its revision can't be put back either.
    const real = b.kv.setItem.bind(b.kv);
    let broke = false;
    vi.spyOn(b.kv, "setItem").mockImplementation((key, value) => {
      if (key === SYNC_KEY.cursor && !broke) {
        broke = true;
        b.kv.failKeys.add(menuKey(ID(1)));
        b.kv.failKeys.add(`sync:menu:${ID(1)}`);
        throw new DOMException("full", "QuotaExceededError");
      }
      real(key, value);
    });
    b.runtime.syncNow();
    await settleUntil(() => broke);
    await settle(2);
    expect(b.menus()[0]).toMatchObject({ encoded: "v2" }); // stuck as written
    expect(announced).toContain(ID(1));
  });
});

describe("stopping while waiting for the lock", () => {
  test("a stopped tab doesn't start syncing when the lock comes through", async () => {
    const shared = new MemoryStore();
    const lock = fakeLock();
    const tab1 = makeDevice(server, new TabStore(shared), lock.lead);
    const tab2 = makeDevice(server, new TabStore(shared), lock.lead);
    await tab1.runtime.start();
    await tab1.runtime.turnOn();
    server.setStatus(await accountIdOf(tab1), "active");
    await tab1.runtime.refreshAccount();
    await tab2.runtime.start();
    await settle();
    tab2.runtime.stop();
    const before = server.requests.length;
    tab1.runtime.stop(); // tab 1 gives the lock up; tab 2's old request comes through
    await settle();
    expect(server.requests.slice(before)).toEqual([]);
  });
});

describe("refusing to act when sync isn't there", () => {
  test("actions that need sync reject with a SyncError", async () => {
    const a = makeDevice(server);
    await a.runtime.start();
    await expect(a.runtime.offerPairing()).rejects.toBeInstanceOf(SyncError);
    await expect(a.runtime.syncCode()).rejects.toBeInstanceOf(SyncError);
    expect(a.kv.getItem(SYNC_KEY.code)).toBeNull();
  });
});
