import { describe, expect, it } from "vitest";
import {
  answerValue,
  importedItemCount,
  parseOutline,
  parseRelationshipMenuFile,
  parseRows,
  parseSectionGrid,
  parseTable,
  readMenuFile,
  titleFromFileName,
} from "./import-formats";
import { planStructuredImport } from "./import-menus";
import { decodeData } from "./data-encoder";

/** A saved menu from relationshipmenu.org, in their current (1.3) shape. */
const theirFile = {
  schema_version: "1.3",
  uuid: "A1B2C3",
  language: "en",
  last_update: "2026-11-20T10:00:00.000Z",
  template_uuid: null,
  people: [
    {
      name: "Ana",
      preferences: [
        { name: "Weekly time together", preference: "must" },
        { name: "Sharing a calendar", preference: "maybe" },
      ],
    },
    { name: "Ben", preferences: { "Weekly time together": "off", "Sharing a calendar": "must" } },
  ],
  menu: [
    {
      name: "Time",
      items: [
        { name: "Weekly time together", icon: null, note: [{ text: "A protected evening" }] },
        { name: "Sharing a calendar", icon: null, note: null },
        { name: "Overnights", icon: null, note: null },
      ],
    },
  ],
};

describe("SV-16: answers written in words, glyphs and tick boxes", () => {
  it.each([
    ["Must have", "must-have"],
    ["must-have", "must-have"],
    ["MUST", "must-have"],
    ["⭐", "must-have"],
    ["✅", "must-have"],
    ["Like to have", "like-to-have"],
    ["would like", "like-to-have"],
    ["👍", "like-to-have"],
    ["Maybe", "maybe"],
    ["not sure", "maybe"],
    ["🤷", "maybe"],
    ["Off limits", "off-limits"],
    ["off-limits", "off-limits"],
    ["hard no", "off-limits"],
    ["✕", "off-limits"],
  ])("%s", (written, expected) => {
    expect(answerValue(written)).toBe(expected);
  });

  it.each(["", "  ", "—", "n/a", "none", "whatever"])("leaves %j unanswered", (written) => {
    expect(answerValue(written)).toBeUndefined();
  });
});

describe("SV-16: spreadsheet and form files", () => {
  it("reads quoted cells, commas inside them, and a BOM", () => {
    const rows = parseRows('\uFEFFItem,Answer\n"Time, weekly",must have\n');
    expect(rows).toEqual([
      ["Item", "Answer"],
      ["Time, weekly", "must have"],
    ]);
  });

  it("reads a Google Sheets export with Item, Group, Answer and Note columns in any order", () => {
    const csv = [
      "Answer,Item,Notes,Category",
      "Must have,Weekly time together,A protected evening,Time",
      "maybe,Sharing a calendar,,Time",
      "Off limits,Overnights,,Time",
      ",Blank one,,Time",
    ].join("\n");
    const read = parseTable(csv, "Fallback");
    expect(read?.menus).toHaveLength(1);
    expect(read?.menus[0].menu).toEqual({
      Time: [
        { item: "Weekly time together", value: "must-have", note: "A protected evening" },
        { item: "Sharing a calendar", value: "maybe" },
        { item: "Overnights", value: "off-limits" },
      ],
    });
  });

  it("reads one menu per person when answers sit side by side", () => {
    const tsv = "Group\tItem\tAna\tBen\nTime\tWeekly time together\tMust have\tOff limits\nTime\tSharing a calendar\tMaybe\tMust have";
    const read = parseTable(tsv, "Fallback");
    expect(read?.menus.map((entry) => entry.title)).toEqual(["Ana", "Ben"]);
    expect(read?.menus[1].menu.Time).toEqual([
      { item: "Weekly time together", value: "off-limits" },
      { item: "Sharing a calendar", value: "must-have" },
    ]);
    expect(read?.menus[0].person).toEqual({ name: "Ana" });
  });

  it("reads a Google Form: a row per respondent, a column per question", () => {
    const csv = [
      "Timestamp,Name,Weekly time together,Sharing a calendar",
      "2026-11-01 10:00,Ana,Must have,Maybe",
      "2026-11-01 10:05,Ben,Off limits,Must have",
    ].join("\n");
    const read = parseTable(csv, "Fallback");
    expect(read?.menus).toHaveLength(2);
    expect(read?.menus[0]).toMatchObject({
      title: "Ana",
      person: { name: "Ana" },
      menu: { Menu: [{ item: "Weekly time together", value: "must-have" }, { item: "Sharing a calendar", value: "maybe" }] },
    });
  });

  it("splits a 'question (person)' header into one menu per person", () => {
    const csv =
      "Item,Weekly time together (Ana),Weekly time together (Ben),Sharing a calendar (Ana),Sharing a calendar (Ben)\n1,Must have,Off limits,Maybe,Must have";
    const read = parseTable(csv, "Fallback");
    expect(read?.menus.map((entry) => entry.title)).toEqual(["Ana", "Ben"]);
    expect(read?.menus[0].menu).toEqual({
      Menu: [
        { item: "Weekly time together", value: "must-have" },
        { item: "Sharing a calendar", value: "maybe" },
      ],
    });
    expect(read?.menus[1].menu.Menu[0]).toEqual({ item: "Weekly time together", value: "off-limits" });
  });

  it("returns null when the file isn't a table of answers", () => {
    expect(parseTable("just some words", "Fallback")).toBeNull();
    expect(parseTable("a,b\nc,d", "Fallback")?.menus ?? []).toEqual([]);
  });
});

describe("SV-16: relationshipmenu.org files", () => {
  it("reads one menu per person, their notes and their answers", () => {
    const read = parseRelationshipMenuFile(JSON.stringify(theirFile), "Fallback");
    expect(read?.source).toBe("relationshipmenu");
    expect(read?.menus.map((entry) => entry.title)).toEqual(["Ana", "Ben"]);
    const [ana, ben] = read!.menus;
    expect(ana.menu.Time).toEqual([
      { item: "Weekly time together", value: "must-have", note: "A protected evening" },
      { item: "Sharing a calendar", value: "maybe" },
      { item: "Overnights" },
    ]);
    expect(ben.menu.Time).toEqual([
      { item: "Weekly time together", value: "off-limits", note: "A protected evening" },
      { item: "Sharing a calendar", value: "must-have" },
      { item: "Overnights" },
    ]);
  });

  it("reads a template file (categories, multilingual titles) as one menu", () => {
    const template = {
      uuid: "T1",
      languages: ["en", "de"],
      categories: [{ title: { en: "Communication", de: "Kommunikation" }, items: [{ title: { en: "Weekly time together" } }] }],
    };
    const read = parseRelationshipMenuFile(JSON.stringify(template), "Their template");
    expect(read?.menus).toEqual([{ title: "Their template", menu: { Communication: [{ item: "Weekly time together" }] } }]);
  });

  it("reads older files whose items carry the answer, and an unanswered menu", () => {
    const old = {
      menu: [{ name: "Time", items: [{ name: "Weekly time together", preference: 1 }, { text: "Overnights" }] }],
    };
    const read = parseRelationshipMenuFile(JSON.stringify(old), "Old");
    expect(read?.menus[0].menu.Time).toEqual([
      { item: "Weekly time together", value: "like-to-have" },
      { item: "Overnights" },
    ]);
  });

  it("isn't fooled by other JSON", () => {
    expect(parseRelationshipMenuFile('{"hello":"world"}', "X")).toBeNull();
    expect(parseRelationshipMenuFile("not json", "X")).toBeNull();
  });
});

describe("SV-16: pasted outlines", () => {
  it("reads headings, bullets and answers written at the end of a line", () => {
    const text = [
      "# Time",
      "- Weekly time together — must have",
      "- Sharing a calendar (maybe)",
      "* Overnights: off limits",
      "## Money",
      "• Joint account — like to have",
    ].join("\n");
    const read = parseOutline(text, "Pasted");
    expect(read?.menus[0].menu).toEqual({
      Time: [
        { item: "Weekly time together", value: "must-have" },
        { item: "Sharing a calendar", value: "maybe" },
        { item: "Overnights", value: "off-limits" },
      ],
      Money: [{ item: "Joint account", value: "like-to-have" }],
    });
  });

  it("reads a list pasted from Notion, with a colon-ended section and tick boxes", () => {
    const text = ["Time:", "☐ Weekly time together", "☑ Sharing a calendar", "- Overnights"].join("\n");
    const read = parseOutline(text, "Pasted");
    expect(read?.menus[0].menu.Time.map((item) => item.item)).toEqual([
      "Weekly time together",
      "Sharing a calendar",
      "Overnights",
    ]);
  });

  it("keeps items with no answers, but not an empty paste", () => {
    expect(parseOutline("Weekly time together\nSharing a calendar", "Pasted")?.menus[0].menu).toEqual({
      Menu: [{ item: "Weekly time together" }, { item: "Sharing a calendar" }],
    });
    expect(parseOutline("   \n\n", "Pasted")).toBeNull();
  });
});

describe("SV-16: choosing a reader", () => {
  it("reads a file by its name, and still reads a mislabelled one", () => {
    expect(readMenuFile(JSON.stringify(theirFile), "ours.json")?.source).toBe("relationshipmenu");
    expect(readMenuFile(JSON.stringify(theirFile), "ours.txt")?.source).toBe("relationshipmenu");
    expect(readMenuFile("Item,Answer\nTime,must have", "menus.txt")?.source).toBe("table");
    expect(readMenuFile("- Weekly time together — must have", "list.csv")?.source).toBe("outline");
  });

  it("makes a readable title from a file name", () => {
    expect(titleFromFileName("our-relationship-menu.json")).toBe("Our Relationship Menu");
    expect(titleFromFileName("menu.csv")).toBe("Menu");
    expect(titleFromFileName("/tmp/.json")).toBe("Imported menu");
  });

  it("counts what was read", () => {
    const read = readMenuFile(JSON.stringify(theirFile), "ours.json")!;
    expect(importedItemCount(read.menus)).toBe(6);
  });
});

describe("SV-16: imported menus follow the usual rules", () => {
  it("adds new menus, keeps answers and person, and never overwrites", () => {
    const read = readMenuFile(JSON.stringify(theirFile), "ours.json")!;
    const planned = planStructuredImport([], read.menus, 1000);
    expect(planned.found).toBe(2);
    expect(planned.add).toHaveLength(2);
    expect(planned.add[0]).toMatchObject({ title: "Ana", person: { name: "Ana" }, createdAt: 1000, updatedAt: 1000 });
    expect(decodeData(planned.add[1].encoded)).toEqual(read.menus[1].menu);
  });

  it("skips a menu already here, and names a copy when the title is taken", () => {
    const read = readMenuFile(JSON.stringify(theirFile), "ours.json")!;
    const first = planStructuredImport([], read.menus, 1000);
    const again = planStructuredImport(first.add, read.menus, 2000);
    expect(again.add).toHaveLength(0);
    expect(again.alreadyHere).toBe(2);

    const other = {
      ...theirFile,
      people: [{ name: "Ana" }],
      menu: [{ name: "Time", items: [{ name: "Something else" }] }],
    };
    const renamed = planStructuredImport(first.add, [{ title: "Ana", menu: { Time: [{ item: "Something else" }] } }], 3000);
    expect(renamed.renamed).toEqual([{ from: "Ana", to: "Ana (2)" }]);
    expect(other.people).toHaveLength(1);
  });
});

describe("SV-16: side-by-side section sheets (non-escalator)", () => {
  // The shape of the widely shared sheet: a preamble, a legend, stretched section
  // titles in the answer column, and blocks of (answer, item) side by side.
  const sheet = [
    ",Instructions: Make a copy of this document and fill it out,,,,,",
    ",🔴 MUST HAVE   ⭕ LIKE TO HAVE   ❓ MAYBE   ❓❌❓ LET'S TALK   ❌ OFF LIMITS,,,,,",
    ",C O M M I T M E N T,,,E M O T I O N A L   I N T I M A C Y,",
    ",❓❌❓,Marriage,,🔴 ,Expressing happiness and joy",
    ",❓,Marriage w/ another partner,,🔴 ,Sharing vulnerable feelings",
    ",⭕,Sharing pet(s),,⭕,Sharing about mental health challenges",
    ",❓❓,Coparenting,,⬜,",
    ",,,,C O M M U N I C A T I O N,",
    ",,,,⭕,Daily or frequent check-ins",
    ",🔴 ,Planning for future,,❌,Don't Ask Don't Tell",
  ].join("\n");

  it("reads every block, its section titles and the emoji answers", () => {
    const read = parseTable(sheet, "Their sheet");
    expect(read?.menus).toHaveLength(1);
    const menu = read!.menus[0].menu;
    expect(Object.keys(menu)).toEqual(["Commitment", "Emotional Intimacy", "Communication"]);
    expect(menu.Commitment).toEqual([
      { item: "Marriage", value: "maybe" },
      { item: "Marriage w/ another partner", value: "maybe" },
      { item: "Sharing pet(s)", value: "like-to-have" },
      { item: "Coparenting", value: "maybe" },
      { item: "Planning for future", value: "must-have" },
    ]);
    expect(menu["Emotional Intimacy"]).toEqual([
      { item: "Expressing happiness and joy", value: "must-have" },
      { item: "Sharing vulnerable feelings", value: "must-have" },
      { item: "Sharing about mental health challenges", value: "like-to-have" },
    ]);
    // A title part-way down a column applies to what follows it.
    expect(menu.Communication).toEqual([
      { item: "Daily or frequent check-ins", value: "like-to-have" },
      { item: "Don't Ask Don't Tell", value: "off-limits" },
    ]);
  });

  it("needs a real grid, not a one-off table", () => {
    expect(parseSectionGrid([["", "❓", "Marriage"]], "X")).toBeNull();
  });

  it("reads the emoji answers on their own", () => {
    expect(answerValue("🔴")).toBe("must-have");
    expect(answerValue("⭕")).toBe("like-to-have");
    expect(answerValue("❓❓")).toBe("maybe");
    expect(answerValue("❓❌❓")).toBe("maybe");
    expect(answerValue("❌")).toBe("off-limits");
    expect(answerValue("⬜")).toBeUndefined();
  });
});

describe("SV-16: one answer per row, marked under its own column", () => {
  it("reads a Must / Like / Maybe / Off limits sheet", () => {
    const csv = [
      "Group,Item,Must have,Like to have,Maybe,Off limits,Notes",
      "Time,Weekly time together,X,,,,A protected evening",
      "Time,Sharing a calendar,,X,,,",
      "Time,Overnights,,,,X,",
      "Time,Pets,,,x,,",
      "Time,Marriage,,,,,",
    ].join("\n");
    const read = parseTable(csv, "Their grid");
    expect(read?.menus[0].menu).toEqual({
      Time: [
        { item: "Weekly time together", value: "must-have", note: "A protected evening" },
        { item: "Sharing a calendar", value: "like-to-have" },
        { item: "Overnights", value: "off-limits" },
        { item: "Pets", value: "maybe" },
        { item: "Marriage" },
      ],
    });
  });

  it("also takes the answer itself or a tick as the mark", () => {
    const csv = ["Item,Must,Like,Off", "Kids,✓,,", "Moving,,must-have,", "Pets,,,✘"].join("\n");
    const read = parseTable(csv, "Marks");
    expect(read?.menus[0].menu.Menu).toEqual([
      { item: "Kids", value: "must-have" },
      { item: "Moving", value: "like-to-have" },
      { item: "Pets", value: "off-limits" },
    ]);
  });
});
