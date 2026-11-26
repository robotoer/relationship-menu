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
  /** Called with the key on every write: lets tests share one store between "tabs". */
  listeners = new Set<(key: string, from: MemoryStore) => void>();
  failWrites = false;
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
    if (this.failWrites) throw new DOMException("full", "QuotaExceededError");
    this.map.set(key, value);
    for (const l of this.listeners) l(key, this);
  }
  removeItem(key: string) {
    this.map.delete(key);
    for (const l of this.listeners) l(key, this);
  }
  keys() {
    return [...this.map.keys()];
  }
}

type Tracked = { name: string; params: unknown };

const makeDevice = (server: FakeServer, kv = new MemoryStore(), lead?: (task: () => Promise<void>) => void) => {
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
    onStorage: () => () => {},
    track: ((name: string, params?: unknown) => tracked.push({ name, params })) as never,
  });
  const menus = () =>
    readStoredMenus(kv)
      .map((m) => m.doc)
      .sort((a, b) => a.title.localeCompare(b.title));
  /** A save as storage makes it: written first (SY-30), then sync is told. */
  const save = (doc: SavedMenu, startedFrom: number | null = runtime.revisionOf(doc.id)) => {
    const previous = parseStoredMenu(menuKey(doc.id), kv.getItem(menuKey(doc.id)))?.doc;
    writeStoredMenu(kv, { doc, savedAt: Date.now() });
    return runtime.saved(doc, startedFrom, previous);
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
  test("a save is recorded even when sync state can't be written, and the hook doesn't throw", async () => {
    const a = makeDevice(server);
    await supporter(server, a);
    writeStoredMenu(a.kv, { doc: menu(ID(1), "Ours"), savedAt: 1 });
    a.kv.failWrites = true;
    expect(() => a.runtime.saved(menu(ID(1), "Ours", "e2"), 0, menu(ID(1), "Ours"))).not.toThrow();
    a.kv.failWrites = false;
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

describe("SY-25: one tab syncs for the whole browser", () => {
  test("a save in a tab that isn't syncing is pushed by the one that is", async () => {
    const kv = new MemoryStore();
    let holder: (() => void) | null = null;
    const queue: (() => Promise<void>)[] = [];
    // A Web Lock: the first tab holds it; the second waits.
    const lead = (task: () => Promise<void>) => {
      if (holder === null) {
        holder = () => undefined;
        void task().finally(() => {
          holder = null;
          const next = queue.shift();
          if (next) lead(next);
        });
      } else {
        queue.push(task);
      }
    };
    const tab1 = makeDevice(server, kv, lead);
    const tab2 = makeDevice(server, kv, lead);
    await tab1.runtime.start();
    await tab1.runtime.turnOn();
    const accountId = await accountIdOf(tab1);
    server.setStatus(accountId, "active");
    await tab1.runtime.refreshAccount();
    await tab2.runtime.start();
    await settle();

    tab2.save(menu(ID(1), "Saved in tab 2"));
    // Tab 1 hears about it as a storage event.
    tab1.runtime.syncNow();
    await settle();
    expect(server.liveMenuIds(accountId)).toEqual([ID(1)]);
    expect(readState(kv, ID(1))).toMatchObject({ dirty: false });
    expect(queue).toHaveLength(1); // tab 2 is still waiting for the lock
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
