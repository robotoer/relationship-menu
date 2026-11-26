/**
 * Property tests for giving older menus ids (spec SY-90, with SV-6). They run the
 * REAL migrateLegacyMenus on random mixes of every older storage format, including
 * an earlier run that stopped part-way, and on runs that crash after any write.
 */
import fc from "fast-check";
import { KeyValueStore, MENU_KEY_PREFIX, StoredMenu, migrateLegacyMenus, readLegacyEntries, readStoredMenus, writeStoredMenu } from "../menu-store";
import { latestByTitle } from "../storage";

/** An in-memory localStorage; can be told to fail ("crash") after N writes. */
class FakeStore implements KeyValueStore {
  map = new Map<string, string>();
  writesLeft = Infinity;
  get length() {
    return this.map.size;
  }
  key(i: number) {
    return Array.from(this.map.keys())[i] ?? null;
  }
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.writesLeft-- <= 0) throw new Error("crash");
    this.map.set(key, value);
  }
  removeItem(key: string) {
    if (this.writesLeft-- <= 0) throw new Error("crash");
    this.map.delete(key);
  }
  snapshot() {
    return new Map(this.map);
  }
}

const TITLES = ["A", "B", "__proto__", "constructor", "", "Ünï"];
const POINTER_KEY = "menu:bagaaierabjnwk4wjmkdx6lzwmn33rbhqbithdrj6sqd3kvdhm62lrpjum4kq";

type Legacy = { format: "current" | "pending" | "ipfsCopy" | "raw"; title: string; encoded: string; savedAt: number; slot: number };
const legacyArb: fc.Arbitrary<Legacy> = fc.record({
  format: fc.constantFrom("current", "pending", "ipfsCopy", "raw"),
  title: fc.constantFrom(...TITLES),
  encoded: fc.constantFrom("e1", "e2", "e3", "e4"),
  savedAt: fc.nat(50),
  slot: fc.nat(3),
});
const existingArb = fc.uniqueArray(
  fc.record({ legacyTitle: fc.constantFrom(...TITLES), encoded: fc.constantFrom("v1", "v2"), savedAt: fc.nat(50) }),
  { selector: (e) => e.legacyTitle, maxLength: 3 }
);

const idFor = (n: number) => `id${String(n).padStart(20, "0")}`;

/** Builds a store holding these older entries, earlier-migrated menus and unrelated keys. */
const build = (legacy: Legacy[], existing: { legacyTitle: string; encoded: string; savedAt: number }[]) => {
  const kv = new FakeStore();
  kv.map.set("analytics_debug", "1");
  kv.map.set(POINTER_KEY, "2025-01-01T00:00:00.000Z"); // an unresolved IPFS pointer: not a menu
  for (const e of legacy) {
    const json = JSON.stringify({ title: e.title, encoded: e.encoded, savedAt: e.savedAt });
    if (e.format === "current") kv.map.set(`menu:${e.title}`, json);
    if (e.format === "pending") kv.map.set(`menu:pending:${e.title}`, json);
    if (e.format === "ipfsCopy") kv.map.set(`menu:bafyCopy${e.slot}`, json);
    if (e.format === "raw") kv.map.set(`menu:${e.title}`, e.encoded); // oldest format: no date
  }
  existing.forEach((e, i) => {
    const menu: StoredMenu = { doc: { id: idFor(900 + i), title: e.legacyTitle, encoded: e.encoded }, savedAt: e.savedAt, legacyTitle: e.legacyTitle };
    writeStoredMenu(kv, menu);
  });
  return kv;
};

/** What each older title should end up as: the newer of its latest old copy and its migrated menu. */
const expected = (kv: FakeStore) => {
  const latest = latestByTitle(readLegacyEntries(kv));
  const migrated = new Map(readStoredMenus(kv).filter((m) => m.legacyTitle !== undefined).map((m) => [m.legacyTitle!, m]));
  const result = new Map<string, string>();
  for (const [title, entry] of Object.entries(latest)) {
    const before = migrated.get(title);
    result.set(title, before && entry.savedAt <= before.savedAt ? before.doc.encoded : entry.doc.encoded);
  }
  return result;
};

// One counter for the whole file, like random ids: never the same id twice.
let nextId = 0;
const run = (kv: FakeStore) => migrateLegacyMenus(kv, () => idFor(nextId++));

describe("SY-90: older menus get ids without losing anything", () => {
  it("every older title ends up as exactly one id-keyed menu holding its newest content", () => {
    fc.assert(
      fc.property(fc.array(legacyArb, { maxLength: 12 }), existingArb, (legacy, existing) => {
        const kv = build(legacy, existing);
        const want = expected(kv);
        const untouchedBefore = readStoredMenus(kv).filter((m) => m.legacyTitle === undefined || !want.has(m.legacyTitle));
        run(kv);

        expect(readLegacyEntries(kv)).toEqual([]);
        const menus = readStoredMenus(kv);
        for (const [title, encoded] of want) {
          const matches = menus.filter((m) => m.legacyTitle === title);
          expect(matches).toHaveLength(1);
          expect(matches[0]!.doc.encoded).toBe(encoded);
          expect(matches[0]!.doc.title).toBe(title);
        }
        // Unrelated keys and menus that weren't involved are left alone.
        expect(kv.getItem("analytics_debug")).toBe("1");
        expect(kv.getItem(POINTER_KEY)).toBe("2025-01-01T00:00:00.000Z");
        for (const m of untouchedBefore) expect(menus).toContainEqual(m);
      })
    );
  });

  it("running it again changes nothing", () => {
    fc.assert(
      fc.property(fc.array(legacyArb, { maxLength: 12 }), existingArb, (legacy, existing) => {
        const kv = build(legacy, existing);
        run(kv);
        const after = kv.snapshot();
        expect(run(kv)).toBe(0);
        expect(kv.snapshot()).toEqual(after);
      })
    );
  });

  it("stopping after any write loses nothing, and the next run finishes without duplicates", () => {
    fc.assert(
      fc.property(fc.array(legacyArb, { minLength: 1, maxLength: 10 }), existingArb, fc.nat(40), (legacy, existing, crashAfter) => {
        const kv = build(legacy, existing);
        const want = expected(kv);
        kv.writesLeft = crashAfter;
        try {
          run(kv);
        } catch {
          // crashed part-way
        }
        kv.writesLeft = Infinity;

        // Nothing lost: each title's content is still there, as an old entry or an id-keyed menu.
        const latestOld = latestByTitle(readLegacyEntries(kv));
        const menus = readStoredMenus(kv);
        for (const [title, encoded] of want) {
          const asMenu = menus.some((m) => m.legacyTitle === title && m.doc.encoded === encoded);
          const asOld = latestOld[title]?.doc.encoded === encoded;
          expect(asMenu || asOld).toBe(true);
        }

        // Finishing the migration gives the same result as an uninterrupted run.
        run(kv);
        expect(readLegacyEntries(kv)).toEqual([]);
        const finished = readStoredMenus(kv);
        for (const [title, encoded] of want) {
          const matches = finished.filter((m) => m.legacyTitle === title);
          expect(matches).toHaveLength(1);
          expect(matches[0]!.doc.encoded).toBe(encoded);
        }
      })
    );
  });

  it("an older title like `menu-v2:…` can't be mistaken for an id-keyed menu", () => {
    const kv = new FakeStore();
    kv.map.set(`menu:${MENU_KEY_PREFIX.slice(5)}x`, JSON.stringify({ title: "v2:x", encoded: "e", savedAt: 1 }));
    expect(readStoredMenus(kv)).toEqual([]);
    expect(readLegacyEntries(kv)).toHaveLength(1);
  });
});
