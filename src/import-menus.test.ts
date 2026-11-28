import { encodeMenuSlug } from "./compare-slug";
import { encodeData } from "./data-encoder";
import { exportText, menuLink } from "./export-menus";
import { importMenuText, importSummary, menuEntries, planStructuredImport, planTextImport, TextImport } from "./import-menus";
import { readMenuFile } from "./import-formats";
import { decodeCompareSlug } from "./compare-slug";
import { decodeData } from "./data-encoder";
import { RelationshipMenuDocument } from "./model/menu";

const walks = encodeData({ G: [{ item: "Walks" }] });
const answered = encodeData({ G: [{ item: "Walks", value: "must-have" }] });
const ORIGIN = "https://wantsandwonts.com";

describe("SV-14: reading menu links from text", () => {
  it("reads the backup file Export all menus makes, and nothing else in it", () => {
    const text = exportText(
      [
        { title: "Us", encoded: walks },
        { title: "Them", encoded: answered, person: { name: "Sam" } },
      ],
      ORIGIN,
      0
    );
    expect(menuEntries(text)).toEqual([
      menuLink(ORIGIN, { title: "Them", encoded: answered, person: { name: "Sam" } }),
      menuLink(ORIGIN, { title: "Us", encoded: walks }),
    ]);
  });

  it("finds a link in a pasted message, and each menu of a compare link", () => {
    const a = encodeMenuSlug("A", walks);
    const b = encodeMenuSlug("B", answered);
    expect(menuEntries(`Here's mine (${ORIGIN}/menu?encoded=${encodeURIComponent(a)}). See you at 10:30!`)).toEqual([
      `${ORIGIN}/menu?encoded=${encodeURIComponent(a)}`,
    ]);
    expect(menuEntries(`${ORIGIN}/compare?encoded=${encodeURIComponent(a)}&encoded=${encodeURIComponent(b)}`)).toEqual([a, b]);
    expect(menuEntries(`  ${a}\n`)).toEqual([a]);
    expect(menuEntries("Re:Hi at 10:30, nothing here")).toEqual([]);
  });
});

describe("SV-14: what an import adds", () => {
  const existing: RelationshipMenuDocument[] = [{ id: "x", title: "Us", encoded: walks, createdAt: 1, updatedAt: 2 }];

  it('skips a menu already here, and adds one whose title is taken as "Title (2)"', () => {
    const text = [menuLink(ORIGIN, { title: "Us", encoded: walks }), menuLink(ORIGIN, { title: "Us", encoded: answered })].join("\n");
    const result = planTextImport(existing, text, 99);
    expect(result).toEqual({
      add: [{ title: "Us (2)", encoded: answered, createdAt: 99, updatedAt: 99 }],
      alreadyHere: 1,
      renamed: [{ from: "Us", to: "Us (2)" }],
      found: 2,
      unreadable: 0,
    });
    expect(importSummary(result)).toBe(
      'Added 1 menu, 1 was already here. You already had a menu called "Us", so the new one is "Us (2)".'
    );
  });

  it("counts a link that can't be read, and never saves it", () => {
    const text = `${menuLink(ORIGIN, { title: "New", encoded: walks })}\n${ORIGIN}/menu?encoded=bm90IGEgbWVudQ%3D%3D:AAAA`;
    const result = planTextImport([], text, 5);
    expect(result.add.map((d) => d.title)).toEqual(["New"]);
    expect(result.unreadable).toBe(1);
    expect(importSummary(result)).toBe("Added 1 menu. 1 link couldn't be read.");
  });
});

describe("SV-14: the summary", () => {
  const plan = (over: Partial<TextImport>): TextImport => ({
    add: [],
    alreadyHere: 0,
    renamed: [],
    found: 0,
    unreadable: 0,
    ...over,
  });
  const doc = (title: string) => ({ title, encoded: walks });

  it("says plainly what happened", () => {
    expect(importSummary(plan({ add: [doc("a"), doc("b"), doc("c")], alreadyHere: 1, found: 4 }))).toBe(
      "Added 3 menus, 1 was already here."
    );
    expect(importSummary(plan({ add: [doc("a")], found: 1 }))).toBe("Added 1 menu.");
    expect(importSummary(plan({ alreadyHere: 2, found: 2 }))).toBe("Nothing new: 2 menus were already here.");
    expect(importSummary(plan({ alreadyHere: 1, found: 1 }))).toBe("Nothing new: 1 menu was already here.");
    expect(importSummary(plan({ add: [doc("Untitled (2)")], found: 1, renamed: [{ from: "", to: "Untitled (2)" }] }))).toBe(
      'Added 1 menu. You already had a menu called "Untitled menu", so the new one is "Untitled (2)".'
    );
    expect(
      importSummary(
        plan({
          add: [doc("a (2)"), doc("b (2)")],
          found: 2,
          renamed: [
            { from: "a", to: "a (2)" },
            { from: "b", to: "b (2)" },
          ],
          unreadable: 2,
        })
      )
    ).toBe('Added 2 menus. 2 were added as copies, like "Title (2)", because their titles were taken. 2 links couldn\'t be read.');
  });

  it("says when there was nothing to import", () => {
    expect(importSummary(plan({}))).toBe(
      "Nothing to import. Paste a menu link, or choose a menu file: a relationshipmenu.org file, a spreadsheet (CSV or TSV), a form's responses, or a list."
    );
    expect(importSummary(plan({ unreadable: 1 }))).toBe(
      "That link or file couldn't be read. A link may have been cut off; a file may not be a menu."
    );
    expect(importSummary(plan({ unreadable: 3 }))).toBe(
      "3 links or files couldn't be read. A link may have been cut off; a file may not be a menu."
    );
  });
});

describe("SV-14: importMenuText", () => {
  const storageWith = (docs: RelationshipMenuDocument[], saved: (n: number) => string[] = (n) => Array.from({ length: n }, (_, i) => `id${i}`)) => ({
    getDocuments: vi.fn(async () => Object.fromEntries(docs.map((d, i) => [`e${i}`, { ...d, id: `e${i}` }]))),
    saveDocuments: vi.fn(async (...add: RelationshipMenuDocument[]) => saved(add.length)),
  });

  it("saves only the new menus, as new entries", async () => {
    const storage = storageWith([{ title: "Us", encoded: walks }]);
    const text = [menuLink(ORIGIN, { title: "Us", encoded: walks }), menuLink(ORIGIN, { title: "Them", encoded: walks })].join("\n");
    const result = await importMenuText(storage, text, 7);
    expect(storage.saveDocuments).toHaveBeenCalledWith({ title: "Them", encoded: walks, createdAt: 7, updatedAt: 7 });
    expect(result.alreadyHere).toBe(1);
  });

  it("saves nothing when nothing is new", async () => {
    const storage = storageWith([{ title: "Us", encoded: walks }]);
    await importMenuText(storage, menuLink(ORIGIN, { title: "Us", encoded: walks }), 7);
    expect(storage.saveDocuments).not.toHaveBeenCalled();
  });

  it("rejects when the menus weren't saved", async () => {
    const storage = storageWith([], () => []);
    await expect(importMenuText(storage, menuLink(ORIGIN, { title: "Us", encoded: walks }), 7)).rejects.toThrow();
  });
});

describe("SV-16 + SV-18: Soft no survives an import", () => {
  it("keeps Soft no in the saved menu, and through its link", () => {
    const read = readMenuFile("Group,Item,Answer\nG,Children,Soft no\nG,Moving,rather not", "their-sheet.csv")!;
    const planned = planStructuredImport([], read.menus, 1);
    expect(planned.found).toBe(1);
    const doc = planned.add[0];
    expect(decodeData(doc.encoded)).toEqual({
      G: [
        { item: "Children", value: "soft-no" },
        { item: "Moving", value: "soft-no" },
      ],
    });
    // Stored and shared through a link, it stays Soft no (not "no answer").
    const throughLink = decodeCompareSlug(encodeMenuSlug(doc.title, doc.encoded));
    expect(throughLink?.menu).toEqual(decodeData(doc.encoded));
  });
});
