import { SENSITIVE_ITEMS } from "./insights-content";
import { isTemplateItem, menuInsights } from "./menu-insights";
import {
  QUOTE_MAX,
  canQuote,
  characterSheet,
  isSensitive,
  levelFor,
  lootName,
  menuLoot,
  quote,
  rarityFor,
} from "./menu-loot";
import { RelationshipMenu } from "./model/menu";

const loot = (menu: RelationshipMenu, variant = 0) => menuLoot(menu, menuInsights(menu), variant);

/** A Wholehearted Otter with a streak of Beaver (as in MenuInsights.test.tsx). */
const otterMenu: RelationshipMenu = {
  Romance: [
    { item: "Holding hands", value: "must-have" },
    { item: "Cuddling", value: "must-have" },
    { item: "Sex", value: "must-have" },
    { item: "Kissing", value: "must-have" },
    { item: "Hugging", value: "must-have" },
  ],
  Home: [
    { item: "Shared cooking", value: "like-to-have", note: "secret note" },
    { item: "Cleaning schedule", value: "like-to-have" },
    { item: "Meeting family", value: "maybe" },
    { item: "Posting about us online", value: "off-limits" },
    { item: "Having or raising kids", value: "off-limits" },
    { item: "Unanswered thing" },
  ],
};

describe("character sheet (IN-10)", () => {
  it("IN-10: a level for every 5 answered items, from 1 up to 20", () => {
    expect([0, 4, 5, 9, 10, 99, 100, 500].map(levelFor)).toEqual([1, 1, 2, 2, 3, 20, 20, 20]);
  });

  it("IN-10: the class follows the animal and its streak; nothing before it hatches", () => {
    expect(characterSheet(menuInsights(otterMenu))).toEqual({
      theme: "closeness",
      multiclass: "hearth",
      level: 3,
    });
    expect(characterSheet(menuInsights({ A: [{ item: "Kissing", value: "maybe" }] }))).toBeNull();
  });
});

describe("rarity (IN-13)", () => {
  it("IN-13: from the share of items answered; Legendary needs every item of 10 or more", () => {
    expect(rarityFor(3, 10)).toBe("common");
    expect(rarityFor(4, 10)).toBe("uncommon");
    expect(rarityFor(7, 10)).toBe("rare");
    expect(rarityFor(9, 10)).toBe("epic");
    expect(rarityFor(10, 10)).toBe("legendary");
    expect(rarityFor(6, 6)).toBe("epic");
    expect(rarityFor(0, 0)).toBe("common");
  });
});

describe("quoting (IN-12)", () => {
  it("IN-12: every flagged item is a template item, and flagged items are sensitive however they're typed", () => {
    for (const item of SENSITIVE_ITEMS) expect(isTemplateItem(item)).toBe(true);
    expect(isSensitive("  SEX ")).toBe(true);
    expect(isSensitive("Marriage   or legal partnership")).toBe(true);
    expect(isSensitive("Kissing")).toBe(false);
  });

  it("IN-12: own items with sensitive words are never quoted; ordinary words that contain them are fine", () => {
    for (const text of ["Kids' bedtime", "Seeing my ex", "Sexy weekends", "Couples therapy", "Talking politics"]) {
      expect(isSensitive(text)).toBe(true);
    }
    for (const text of ["Texting at lunch", "Exercise together", "Trip to Sussex", "Index cards", "Express delivery"]) {
      expect(isSensitive(text)).toBe(false);
    }
  });

  it("IN-12: tender topics can be quoted as wants, never on the Off limits or Maybe lines", () => {
    for (const text of ["Sex", "Having or raising kids", "Talking about mental health", "Coming out to my parents"]) {
      expect(canQuote(text, "must-have")).toBe(true);
      expect(canQuote(text, "like-to-have")).toBe(true);
      expect(canQuote(text, "maybe")).toBe(false);
      expect(canQuote(text, "off-limits")).toBe(false);
    }
    expect(canQuote("Posting about us online", "off-limits")).toBe(true);
    for (const text of ["Comedic timing", "Outdoor dates", "Being out about us at work", "My medication"]) {
      expect(isSensitive(text)).toBe(text !== "Comedic timing" && text !== "Outdoor dates");
    }
  });

  it(`IN-12: quotes are cut to ${QUOTE_MAX} characters`, () => {
    expect(quote("  Holding   hands ")).toBe("Holding hands");
    const long = quote("A".repeat(60));
    expect(long).toHaveLength(QUOTE_MAX);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("loot (IN-11)", () => {
  it("IN-11, IN-12: name, rarity, theme stats and lines; tender topics only as wants, never notes", () => {
    const item = loot(otterMenu);
    expect(item).not.toBeNull();
    if (!item) return;
    expect(lootName(item)).toBe("Unwavering Weighted Blanket of Holding hands");
    expect(item.suffixIsQuote).toBe(true);
    // 10 of 11 items answered.
    expect(item.rarity).toBe("epic");
    expect(item.themeStats).toEqual([
      { theme: "closeness", score: 3 },
      { theme: "hearth", score: 2 },
    ]);
    expect(item.lines).toEqual([
      { answer: "must-have", text: "Cuddling" },
      { answer: "must-have", text: "Sex" },
      { answer: "like-to-have", text: "Shared cooking" },
      { answer: "maybe", text: "Meeting family" },
      { answer: "off-limits", text: "Posting about us online" },
    ]);
    // "Having or raising kids" is Off limits, so it's never "Immune to".
    expect(JSON.stringify(item)).not.toMatch(/kids|secret note/);
  });

  it("IN-11: Roll again changes the words and which items are quoted, nothing else", () => {
    const first = loot(otterMenu, 0);
    const second = loot(otterMenu, 1);
    expect(second && lootName(second)).toBe("Blazing Weighted Blanket of Cuddling");
    expect(second?.lines.slice(0, 2).map((l) => l.text)).toEqual(["Sex", "Kissing"]);
    expect(loot(otterMenu, 3)?.base).toBe("Cuddle Gauntlets");
    expect(second?.rarity).toBe(first?.rarity);
    expect(second?.themeStats).toEqual(first?.themeStats);
  });

  it("IN-11: with no Must haves, the phrase of the streak's theme (or the animal's)", () => {
    const menu: RelationshipMenu = {
      A: [
        { item: "Sex", value: "like-to-have" },
        { item: "Kissing", value: "like-to-have" },
        { item: "Hugging", value: "like-to-have" },
        { item: "Shared cooking", value: "like-to-have" },
        { item: "Cleaning schedule", value: "like-to-have" },
      ],
    };
    const item = loot(menu);
    expect(item?.suffixIsQuote).toBe(false);
    expect(item && lootName(item)).toBe("Sharpened Weighted Blanket of the Hearth");
  });

  it("IN-11: the Chameleon's loot, and nothing before hatching", () => {
    const own: RelationshipMenu = {
      Weekend: Array.from({ length: 5 }, (_, i) => ({ item: `Crossword ${i}`, value: "maybe" as const })),
    };
    expect(loot(own)?.base).toBe("Mimic Chest");
    expect(loot(own)?.lines).toEqual([{ answer: "maybe", text: "Crossword 0" }]);
    expect(loot({ A: [{ item: "Kissing", value: "must-have" }] })).toBeNull();
  });
});
