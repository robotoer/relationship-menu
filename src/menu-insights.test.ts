import { GROUP_THEMES, ITEM_THEMES, THEMES } from "./insights-content";
import {
  HATCH_AT,
  isTemplateItem,
  menuInsights,
  normalizeText,
  pickWording,
  styleOf,
  themeOf,
} from "./menu-insights";
import { RelationshipMenu, RelationshipMenuItemValue } from "./model/menu";
import { GROUP_TEMPLATES, MENU_TEMPLATES } from "./templates";

const templateItems = [
  ...MENU_TEMPLATES.flatMap((t) => Object.values(t.groups).flat()),
  ...GROUP_TEMPLATES.flatMap((g) => g.items),
];
const templateGroups = [
  ...MENU_TEMPLATES.flatMap((t) => Object.keys(t.groups)),
  ...GROUP_TEMPLATES.map((g) => g.name),
];

/** A one-group menu from [text, answer] pairs. */
const menuOf = (group: string, items: [string, RelationshipMenuItemValue?][]): RelationshipMenu => ({
  [group]: items.map(([item, value]) => (value ? { item, value } : { item })),
});

const repeat = (n: number, value: RelationshipMenuItemValue, prefix: string) =>
  Array.from({ length: n }, (_, i): [string, RelationshipMenuItemValue] => [`${prefix} ${i}`, value]);

describe("themes (IN-2)", () => {
  it("IN-2: every template item has exactly one theme, and every tag is a template item", () => {
    const tagged = THEMES.flatMap((theme) => ITEM_THEMES[theme].map(normalizeText));
    expect(new Set(tagged).size).toBe(tagged.length);
    const items = new Set(templateItems.map(normalizeText));
    for (const item of items) expect(tagged).toContain(item);
    for (const tag of tagged) expect(items).toContain(tag);
  });

  it("IN-2: every group tag is a template group", () => {
    const groups = new Set(templateGroups.map(normalizeText));
    for (const theme of THEMES) {
      for (const group of GROUP_THEMES[theme]) expect(groups).toContain(normalizeText(group));
    }
  });

  it("IN-2: template text matches ignoring case, spacing and curly quotes", () => {
    expect(themeOf("  KISSING ", "Anything")).toBe("closeness");
    expect(themeOf("Saying ‘I love you’", "Anything")).toBe("closeness");
    expect(themeOf("Joint   bank account", "Anything")).toBe("hearth");
    expect(isTemplateItem("shared cooking")).toBe(true);
    expect(isTemplateItem("Sunday crossword")).toBe(false);
  });

  it("IN-2: own items use keywords on their text, then their group", () => {
    expect(themeOf("Cuddling on the sofa", "Weekend")).toBe("closeness");
    expect(themeOf("Text me when you land", "Travel")).toBe("talk");
    expect(themeOf("Sunday crossword", "Communication")).toBe("talk");
    expect(themeOf("Sunday crossword", "Our weekend chores")).toBe("hearth");
    expect(themeOf("Sunday crossword", "Weekend stuff")).toBeNull();
    // Keyword order: "pet care" is Hearth, not Care.
    expect(themeOf("Dog care rota with the pets", "Misc")).toBe("hearth");
  });
});

describe("scores (IN-3)", () => {
  it("IN-3: a theme's score is the mean rank of its answered items, from 2 answers", () => {
    const one = menuInsights(menuOf("Romance", [["Kissing", "must-have"]]));
    expect(one.themes.find((t) => t.theme === "closeness")).toEqual({
      theme: "closeness",
      answered: 1,
      score: null,
    });
    const two = menuInsights(
      menuOf("Romance", [
        ["Kissing", "must-have"],
        ["Hugging", "maybe"],
        ["Cuddling"],
        ["   ", "off-limits"],
      ])
    );
    // Must have (4) and Maybe (2) average to 3 on the five-answer scale (SV-18).
    expect(two.themes.find((t) => t.theme === "closeness")).toEqual({
      theme: "closeness",
      answered: 2,
      score: 3,
    });
    expect(two.items).toBe(3);
    expect(two.answered).toBe(2);
  });

  it("IN-3: answers that aren't one of the four count as unanswered (DM-2)", () => {
    const menu = { A: [{ item: "Kissing", value: "yes please" }] } as unknown as RelationshipMenu;
    expect(menuInsights(menu).answered).toBe(0);
  });
});

describe("animal and style (IN-4, IN-5)", () => {
  it("IN-4: hatching until 5 answers, saying how many more", () => {
    const insights = menuInsights(menuOf("Romance", [["Kissing", "must-have"], ["Hugging", "maybe"]]));
    expect(insights.animal).toEqual({ kind: "hatching", needed: HATCH_AT - 2 });
  });

  it("IN-4: the top theme's animal, with a streak from a second theme scoring 2+", () => {
    const menu: RelationshipMenu = {
      Romance: [
        { item: "Kissing", value: "must-have" },
        { item: "Cuddling", value: "must-have" },
      ],
      Chores: [
        { item: "Shared cooking", value: "like-to-have" },
        { item: "Cleaning schedule", value: "like-to-have" },
      ],
      Space: [
        { item: "Quiet hours", value: "maybe" },
        { item: "Separate bedrooms", value: "off-limits" },
      ],
    };
    const { animal } = menuInsights(menu);
    expect(animal).toMatchObject({ kind: "animal", theme: "closeness", streak: "hearth" });
  });

  it("IN-4: ties go to more answered items, then the theme order", () => {
    const tiedByScore: RelationshipMenu = {
      A: [
        { item: "Shared cooking", value: "must-have" },
        { item: "Cleaning schedule", value: "must-have" },
        { item: "Pet care", value: "must-have" },
        { item: "Kissing", value: "must-have" },
        { item: "Hugging", value: "must-have" },
      ],
    };
    expect(menuInsights(tiedByScore).animal).toMatchObject({ theme: "hearth", streak: "closeness" });
    const tiedFully: RelationshipMenu = {
      A: [
        { item: "Shared cooking", value: "must-have" },
        { item: "Cleaning schedule", value: "must-have" },
        { item: "Kissing", value: "must-have" },
        { item: "Hugging", value: "must-have" },
        { item: "Sunday crossword", value: "must-have" },
      ],
    };
    expect(menuInsights(tiedFully).animal).toMatchObject({ theme: "closeness", streak: "hearth" });
  });

  it("IN-4: the Chameleon when no theme has a score", () => {
    const { animal } = menuInsights(menuOf("Weekend stuff", repeat(5, "like-to-have", "Crossword")));
    expect(animal).toEqual({ kind: "animal", theme: null, style: "decisive", streak: null });
  });

  it("IN-5: the first style that applies", () => {
    const counts = (m: number, l: number, y: number, o: number) => ({
      "must-have": m,
      "like-to-have": l,
      maybe: y,
      "soft-no": 0,
      "off-limits": o,
    });
    expect(styleOf(counts(5, 0, 4, 1), 10)).toBe("curious");
    expect(styleOf(counts(5, 2, 1, 2), 10)).toBe("wholehearted");
    expect(styleOf(counts(2, 4, 1, 3), 10)).toBe("discerning");
    expect(styleOf(counts(2, 8, 0, 0), 10)).toBe("decisive");
    expect(styleOf(counts(2, 6, 1, 1), 10)).toBe("easygoing");
  });
});

describe("badges (IN-7)", () => {
  const ids = (menu: RelationshipMenu) =>
    menuInsights(menu)
      .badges.filter((b) => b.earned)
      .map((b) => b.id);

  it("IN-7: effort badges are listed unearned; answer badges only once earned", () => {
    const { badges } = menuInsights(menuOf("A", [["Kissing", "must-have"]]));
    expect(badges.map((b) => b.id)).toEqual([
      "hatched",
      "cartographer",
      "well-rounded",
      "fine-print",
      "homebrewer",
    ]);
    expect(badges.every((b) => !b.earned)).toBe(true);
  });

  it("IN-7: each badge is earned by its rule", () => {
    expect(ids(menuOf("A", repeat(5, "like-to-have", "Item")))).toEqual(["hatched", "homebrewer"]);
    expect(ids(menuOf("A", repeat(10, "like-to-have", "Item")))).toContain("cartographer");
    expect(ids(menuOf("A", [...repeat(10, "like-to-have", "Item"), ["Unanswered"]]))).not.toContain(
      "cartographer"
    );
    const answers = menuOf("A", [
      ["Kissing", "must-have"],
      ["Hugging", "like-to-have"],
      ["Cuddling", "maybe"],
      ["Overnights", "soft-no"],
      ["Sex", "off-limits"],
    ]);
    expect(ids(answers)).toEqual(["hatched", "boundary-keeper", "full-spectrum"]);
    const noted: RelationshipMenu = {
      A: Array.from({ length: 5 }, (_, i) => ({ item: "Kissing", note: i ? `note ${i}` : " " })),
    };
    expect(ids(noted)).not.toContain("fine-print");
    noted.A.push({ item: "Hugging", note: "only at home" });
    expect(ids(noted)).toContain("fine-print");
  });

  it("IN-7: Well-Rounded needs a score in every theme", () => {
    const menu: RelationshipMenu = Object.create(null);
    for (const theme of THEMES) {
      menu[theme] = ITEM_THEMES[theme].slice(0, 2).map((item) => ({ item, value: "maybe" as const }));
    }
    expect(ids(menu)).toContain("well-rounded");
    menu.adventure.pop();
    expect(ids(menu)).not.toContain("well-rounded");
  });
});

describe("wording (IN-6)", () => {
  it("IN-6: any whole number picks a wording, going round the list", () => {
    const list = ["a", "b", "c"];
    expect([0, 1, 2, 3, -1, 7].map((n) => pickWording(list, n))).toEqual(["a", "b", "c", "a", "c", "b"]);
  });
});
