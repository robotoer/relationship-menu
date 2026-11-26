import * as storage from "./storage";
import { createLocalStorage } from "./storage";
import { MENU_ID_PATTERN } from "./menu-id";
import { menuKey } from "./menu-store";
import { RelationshipMenuDocument } from "./model/menu";

/** The saved menus as `title → document without id`, for easy comparison. */
const byTitle = (docs: { [id: string]: RelationshipMenuDocument }) =>
  Object.fromEntries(Object.values(docs).map(({ id: _, ...doc }) => [doc.title, doc]));

describe("LocalStorage (SY-20, SY-21: menus are keyed by a random id)", () => {
  let storage: ReturnType<typeof createLocalStorage>;

  beforeEach(() => {
    localStorage.clear();
    storage = createLocalStorage();
  });

  test("saves and retrieves documents under a random id", async () => {
    const doc: RelationshipMenuDocument = { title: "Test Document", encoded: "encoded-content" };
    const [id] = await storage.saveDocuments(doc);
    expect(id).toMatch(MENU_ID_PATTERN);
    const documents = await storage.getDocuments();
    expect(documents[id!]).toEqual({ ...doc, id });
    expect(localStorage.getItem(menuKey(id!))).not.toBeNull();
  });

  test("keeps the id it's given, so a rename is an ordinary save of the same entry", async () => {
    const [id] = await storage.saveDocuments({ title: "Before", encoded: "x" });
    await storage.saveDocuments({ id, title: "After", encoded: "x" });
    const documents = await storage.getDocuments();
    expect(Object.keys(documents)).toEqual([id]);
    expect(documents[id!]?.title).toBe("After");
  });

  test("two menus may share a title without overwriting each other", async () => {
    const ids = await storage.saveDocuments({ title: "Same", encoded: "a" }, { title: "Same", encoded: "b" });
    const documents = await storage.getDocuments();
    expect(ids[0]).not.toBe(ids[1]);
    expect(Object.values(documents).map((d) => d.encoded).sort()).toEqual(["a", "b"]);
  });

  test("getDocuments(id) returns only that menu", async () => {
    const [a] = await storage.saveDocuments({ title: "A", encoded: "1" }, { title: "B", encoded: "2" });
    expect(Object.keys(await storage.getDocuments(a))).toEqual([a]);
  });

  test("deleteDocument removes that menu by id and keeps the others", async () => {
    const [keep, remove] = await storage.saveDocuments({ title: "Keep", encoded: "a" }, { title: "Remove", encoded: "b" });
    await storage.deleteDocument(remove!);
    const documents = await storage.getDocuments();
    expect(Object.keys(documents)).toEqual([keep]);
  });

  test("ignores non-menu localStorage entries", async () => {
    localStorage.setItem("other-key", "other-value");
    await storage.saveDocuments({ title: "My Menu", encoded: "e" });
    expect(Object.values(await storage.getDocuments()).map((d) => d.title)).toEqual(["My Menu"]);
    expect(localStorage.getItem("other-key")).toBe("other-value");
  });
});

describe("SV-9, SY-90: menus saved by older versions get ids on load", () => {
  const s = storage;
  beforeEach(() => localStorage.clear());

  test("reads raw and JSON (title- and CID-keyed) entries, then stores them by id", async () => {
    localStorage.setItem("menu:Raw Menu", "raw-encoded-content");
    localStorage.setItem(
      "menu:bafyreigdmqpykrgxyaxtlafqpqhzrusn5nugbkjf3iy2grdiqbpnb2jcri",
      JSON.stringify({ title: "IPFS Menu", encoded: "ipfs-encoded-content" })
    );
    const documents = await s.createLocalStorage().getDocuments();
    expect(byTitle(documents)).toEqual({
      "Raw Menu": { title: "Raw Menu", encoded: "raw-encoded-content" },
      "IPFS Menu": { title: "IPFS Menu", encoded: "ipfs-encoded-content" },
    });
    for (const id of Object.keys(documents)) expect(id).toMatch(MENU_ID_PATTERN);
    // The old entries are gone; the id-keyed ones replaced them.
    expect(s.readLocalMenuEntries()).toEqual([]);
  });

  test("keeps the most recently saved copy of each title (SV-6)", async () => {
    localStorage.setItem("menu:bafyOld", JSON.stringify({ title: "A", encoded: "old", savedAt: 1 }));
    localStorage.setItem("menu:pending:A", JSON.stringify({ title: "A", encoded: "newer", savedAt: 2 }));
    localStorage.setItem("menu:B", "raw-b");
    const documents = byTitle(await s.createLocalStorage().getDocuments());
    expect(documents.A?.encoded).toBe("newer");
    expect(documents.B).toEqual({ title: "B", encoded: "raw-b" });
  });

  test("gives each migrated menu the same id on every later load", async () => {
    localStorage.setItem("menu:A", JSON.stringify({ title: "A", encoded: "1", savedAt: 1 }));
    const first = Object.keys(await s.createLocalStorage().getDocuments());
    const second = Object.keys(await s.createLocalStorage().getDocuments());
    expect(second).toEqual(first);
  });

  test("a save from a tab still running an old version updates the same menu", async () => {
    localStorage.setItem("menu:A", JSON.stringify({ title: "A", encoded: "1", savedAt: 1 }));
    const [id] = Object.keys(await s.createLocalStorage().getDocuments());
    // The old tab writes its usual title-keyed entry, later than the migration.
    localStorage.setItem("menu:A", JSON.stringify({ title: "A", encoded: "2", savedAt: Date.now() + 1000 }));
    const documents = await s.createLocalStorage().getDocuments();
    expect(Object.keys(documents)).toEqual([id]);
    expect(documents[id!]?.encoded).toBe("2");
  });

  test("latestByTitle keeps the most recently saved version of each legacy menu", () => {
    localStorage.setItem("menu:cidOld", JSON.stringify({ title: "A", encoded: "old", savedAt: 1 }));
    localStorage.setItem("menu:cidNew", JSON.stringify({ title: "A", encoded: "new", savedAt: 2 }));
    localStorage.setItem("menu:B", "raw-b");
    const latest = s.latestByTitle(s.readLocalMenuEntries());
    expect(latest.A?.doc.encoded).toBe("new");
    expect(latest.B?.doc).toEqual({ title: "B", encoded: "raw-b" });
  });
});

describe("menus with titles that match built-in object properties (DM-4)", () => {
  const s = storage;
  beforeEach(() => localStorage.clear());

  it("lists menus titled constructor, toString or __proto__", async () => {
    localStorage.setItem("menu:c1", JSON.stringify({ title: "constructor", encoded: "e1", savedAt: 1 }));
    localStorage.setItem("menu:c2", JSON.stringify({ title: "toString", encoded: "e2", savedAt: 1 }));
    localStorage.setItem("menu:c3", JSON.stringify({ title: "__proto__", encoded: "e3", savedAt: 1 }));
    const docs = await s.createLocalStorage().getDocuments();
    expect(Object.values(docs).map((d) => d.title).sort()).toEqual(["__proto__", "constructor", "toString"]);
  });
});
