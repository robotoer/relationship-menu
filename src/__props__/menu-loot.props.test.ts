/**
 * Property tests for the character sheet and loot (docs/spec/insights.md, IN-10..IN-13).
 */
import fc from "fast-check";
import { RARITIES } from "../insights-content";
import { ANSWERS, menuInsights } from "../menu-insights";
import { QUOTE_MAX, canQuote, characterSheet, menuLoot, quote } from "../menu-loot";
import { RelationshipMenu, RelationshipMenuItemValue } from "../model/menu";
import { answerArb, menuArb } from "./arbitraries";

/** Notes carry this mark, so a quoted note would show. */
const NOTE_MARK = "⚑";

/** Template and own items, sensitive and not, often repeated. */
const itemTextArb = fc.oneof(
  fc.constantFrom(
    "Sex",
    "Having or raising kids",
    "Exclusivity",
    "Kissing",
    "Hugging",
    "Cuddling",
    "Shared cooking",
    "Cleaning schedule",
    "Traveling together",
    "Time alone respected",
    "Emotional support",
    "Seeing my ex",
    "Sunday crossword",
    "A very long item that goes on and on well past the forty character limit",
    "A very long item that goes on and on well past where it is cut off"
  ),
  fc.string({ maxLength: 12 })
);

const richMenuArb: fc.Arbitrary<RelationshipMenu> = fc
  .array(
    fc.tuple(
      fc.constantFrom("Romance", "Home", "Weekend", "__proto__", "Mixed"),
      fc.array(
        fc.record(
          { item: itemTextArb, value: answerArb, note: fc.string({ maxLength: 6 }).map((n) => NOTE_MARK + n) },
          { requiredKeys: ["item"] }
        ),
        { maxLength: 10 }
      )
    ),
    { maxLength: 5 }
  )
  .map((pairs) => {
    const menu: RelationshipMenu = Object.create(null);
    for (const [name, items] of pairs) {
      if (!Object.prototype.hasOwnProperty.call(menu, name)) {
        Object.defineProperty(menu, name, { value: items, enumerable: true, writable: true, configurable: true });
      }
    }
    return menu;
  });

const anyMenuArb = fc.oneof(menuArb, richMenuArb);

/** Every item of the menu as [text, answer]. */
const entries = (menu: RelationshipMenu) =>
  Object.values(menu).flatMap((items) =>
    Array.isArray(items) ? items.map((i) => [i.item, i.value] as const) : []
  );

describe("loot properties", () => {
  it("IN-10: a sheet and loot exactly when the animal has hatched; level 1–20", () => {
    fc.assert(
      fc.property(anyMenuArb, (menu) => {
        const insights = menuInsights(menu);
        const sheet = characterSheet(insights);
        const loot = menuLoot(menu, insights);
        const hatched = insights.animal.kind === "animal";
        expect(sheet !== null).toBe(hatched);
        expect(loot !== null).toBe(hatched);
        if (sheet) {
          expect(sheet.level).toBeGreaterThanOrEqual(1);
          expect(sheet.level).toBeLessThanOrEqual(20);
        }
      })
    );
  });

  it("IN-12: quotes are only item text with that answer, never notes, never a tender topic on a joke line, at most 40 characters", () => {
    fc.assert(
      fc.property(anyMenuArb, fc.integer({ min: 0, max: 20 }), (menu, variant) => {
        const loot = menuLoot(menu, menuInsights(menu), variant);
        if (!loot) return;
        const items = entries(menu);
        const quoted: [string, RelationshipMenuItemValue][] = loot.lines.map((l) => [l.text, l.answer]);
        if (loot.suffixIsQuote) quoted.push([loot.suffix, "must-have"]);
        for (const [text, answer] of quoted) {
          expect(text.length).toBeLessThanOrEqual(QUOTE_MAX);
          expect(text).not.toContain(NOTE_MARK);
          const sources = items.filter(([item, value]) => value === answer && quote(item) === text);
          expect(sources.length).toBeGreaterThan(0);
          expect(sources.some(([item, value]) => value !== undefined && canQuote(item, value))).toBe(true);
        }
        // No text is quoted twice.
        expect(new Set(quoted.map(([text]) => text)).size).toBe(quoted.length);
      })
    );
  });

  it("IN-13: level and rarity depend only on how many items are answered, not which answers", () => {
    fc.assert(
      fc.property(anyMenuArb, fc.integer({ min: 1, max: 3 }), (menu, shift) => {
        // The same items answered, every answer swapped for another one.
        const swapped: RelationshipMenu = Object.create(null);
        for (const [name, items] of Object.entries(menu)) {
          Object.defineProperty(swapped, name, {
            value: items.map((i) =>
              i.value ? { ...i, value: ANSWERS[(ANSWERS.indexOf(i.value) + shift) % ANSWERS.length] } : i
            ),
            enumerable: true,
          });
        }
        const a = menuInsights(menu);
        const b = menuInsights(swapped);
        expect(characterSheet(b)?.level).toBe(characterSheet(a)?.level);
        expect(menuLoot(swapped, b)?.rarity).toBe(menuLoot(menu, a)?.rarity);
      })
    );
  });

  it("IN-11: Roll again keeps the rarity and theme stats, and at most six lines", () => {
    fc.assert(
      fc.property(anyMenuArb, fc.integer({ min: 0, max: 50 }), (menu, variant) => {
        const insights = menuInsights(menu);
        const base = menuLoot(menu, insights, 0);
        const rolled = menuLoot(menu, insights, variant);
        if (!base || !rolled) return;
        expect(rolled.rarity).toBe(base.rarity);
        expect(RARITIES).toContain(rolled.rarity);
        expect(rolled.themeStats).toEqual(base.themeStats);
        expect(rolled.lines.length).toBeLessThanOrEqual(6);
      })
    );
  });
});
