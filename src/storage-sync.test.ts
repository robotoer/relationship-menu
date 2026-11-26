/**
 * Storage with sync on (spec §5, §6): saves and deletions are written first and
 * then recorded for sync; reads carry revisions; the editor's saves keep a
 * version synced in meanwhile. No network here: the runtime never leads.
 */
import { encodeData } from "./data-encoder";
import { menuKey } from "./menu-store";
import { createLocalStorage, sameMenuContent } from "./storage";
import { readState, writeSecret } from "./sync/local-store";
import { createSyncRuntime } from "./sync/runtime";

const ID = "menuAAAAAAAAAAAAAAAAAA";
const encoded = (answer: "must-have" | "maybe") => encodeData({ Touch: [{ item: "Hugs", value: answer }] });

const syncOn = async () => {
  writeSecret(localStorage, new Uint8Array(32).fill(1));
  const runtime = createSyncRuntime({
    supported: async () => true,
    lead: () => undefined,
    api: { fetch: () => Promise.reject(new TypeError("offline")) },
    onStorage: () => () => {},
    onVisibilityChange: () => () => {},
    track: (() => undefined) as never,
  });
  await runtime.start();
  return { runtime, storage: createLocalStorage({ sync: runtime }) };
};

beforeEach(() => localStorage.clear());

describe("SY-24: with sync on, menus carry a local revision", () => {
  test("reads include it; every save moves it on; with sync off there's none", async () => {
    const plain = createLocalStorage();
    await plain.saveDocuments({ id: ID, title: "Ours", encoded: encoded("maybe") });
    expect((await plain.getDocuments())[ID]).not.toHaveProperty("revision");

    const { storage } = await syncOn();
    expect((await storage.getDocuments())[ID]?.revision).toBe(0);
    const r1 = await storage.saveMenu({ id: ID, title: "Ours", encoded: encoded("must-have") }, 0);
    expect(r1).toBe(1);
    expect((await storage.getDocuments())[ID]?.revision).toBe(1);
    // It never ends up in the stored menu itself.
    expect(JSON.parse(localStorage.getItem(menuKey(ID))!)).not.toHaveProperty("revision");
  });
});

describe("SY-30: saves are written first, then recorded for sync", () => {
  test("a save marks the menu to be pushed; a deletion is recorded as one to push", async () => {
    const { storage } = await syncOn();
    await storage.saveMenu({ id: ID, title: "Ours", encoded: encoded("maybe") }, null);
    expect(localStorage.getItem(menuKey(ID))).not.toBeNull();
    expect(readState(localStorage, ID)).toMatchObject({ dirty: true, baseVersion: 0 });
    await storage.deleteDocument(ID);
    expect(localStorage.getItem(menuKey(ID))).toBeNull();
  });
});

describe("SY-35: an editor saving over a version it never saw", () => {
  test("keeps its own edit under the menu's id and the other as \"(from another device)\"", async () => {
    const { storage } = await syncOn();
    const opened = await storage.saveMenu({ id: ID, title: "Ours", encoded: encoded("maybe"), updatedAt: 1 }, null);
    // Something else (sync, or this menu in another tab) saves a new version.
    await storage.saveDocuments({ id: ID, title: "Ours", encoded: encoded("must-have"), updatedAt: 2 });
    // The editor still has the version it opened, and saves a different edit on top.
    await storage.saveMenu({ id: ID, title: "Ours", encoded: encodeData({ Touch: [] }), updatedAt: 3 }, opened);
    const docs = Object.values(await storage.getDocuments()).map((d) => [d.title, d.encoded]);
    expect(docs.sort()).toEqual(
      [
        ["Ours", encodeData({ Touch: [] })],
        ["Ours (from another device)", encoded("must-have")],
      ].sort()
    );
  });
});

describe("SY-28, SY-33: showing a synced change in the editor isn't a new edit", () => {
  test("saving what's already stored writes nothing and leaves the menu clean", async () => {
    const { storage } = await syncOn();
    const r1 = await storage.saveMenu({ id: ID, title: "Ours", encoded: encoded("maybe") }, null);
    localStorage.setItem(`sync:menu:${ID}`, JSON.stringify({ ...readState(localStorage, ID), dirty: false }));
    const before = localStorage.getItem(menuKey(ID));
    const r2 = await storage.saveMenu({ id: ID, title: "Ours", encoded: encoded("maybe"), updatedAt: Date.now() + 5 }, r1);
    expect(r2).toBe(r1);
    expect(localStorage.getItem(menuKey(ID))).toBe(before);
    expect(readState(localStorage, ID)).toMatchObject({ dirty: false });
  });

  test("the same menu counts as the same even when its fields were encoded in another order", () => {
    const a = { title: "Ours", encoded: encodeData({ Touch: [{ item: "Hugs", value: "maybe", note: "n" }] }) };
    const b = { title: "Ours", encoded: encodeData({ Touch: [{ note: "n", value: "maybe", item: "Hugs" }] }) };
    expect(a.encoded).not.toBe(b.encoded);
    expect(sameMenuContent(a, b)).toBe(true);
    expect(sameMenuContent(a, { ...b, title: "Other" })).toBe(false);
    expect(sameMenuContent(a, { title: "Ours", encoded: encodeData({ Touch: [{ item: "Hugs", value: "must-have", note: "n" }] }) })).toBe(false);
    expect(sameMenuContent({ ...a, person: {} }, a)).toBe(true);
  });
});
