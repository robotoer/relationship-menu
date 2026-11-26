/**
 * Property tests for "Just for fun" (docs/spec/insights.md) on generated menus.
 */
import fc from "fast-check";
import { BADGE_TEXT, THEMES } from "../insights-content";
import { HATCH_AT, THEME_MIN, menuInsights, rankThemes, themeOf } from "../menu-insights";
import { RelationshipMenu } from "../model/menu";
import { menuArb } from "./arbitraries";

/** Rebuilds a menu prototype-free (group names can be "__proto__"), groups and items in a new order. */
const rebuild = (
  menu: RelationshipMenu,
  order: <T>(list: T[]) => T[],
  mapItem = (item: RelationshipMenu[string][number]) => item
): RelationshipMenu => {
  const copy: RelationshipMenu = Object.create(null);
  for (const [name, items] of order(Object.entries(menu))) {
    Object.defineProperty(copy, name, {
      value: order(items.map(mapItem)),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return copy;
};
const reversed = <T,>(list: T[]) => [...list].reverse();
const same = <T,>(list: T[]) => [...list];

describe("menu insight properties", () => {
  it("IN-2: an item's theme is one of the themes or none, and never depends on the answer", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 20 }), fc.string({ maxLength: 20 }), (item, group) => {
        const theme = themeOf(item, group);
        expect(theme === null || (THEMES as readonly string[]).includes(theme)).toBe(true);
      })
    );
  });

  it("IN-3: scores are 0–3 from THEME_MIN answers, and never more answers than were given", () => {
    fc.assert(
      fc.property(menuArb, (menu) => {
        const insights = menuInsights(menu);
        expect(insights.themes.map((t) => t.theme)).toEqual([...THEMES]);
        for (const t of insights.themes) {
          if (t.answered < THEME_MIN) expect(t.score).toBeNull();
          else {
            expect(t.score).toBeGreaterThanOrEqual(0);
            expect(t.score).toBeLessThanOrEqual(3);
          }
        }
        const themed = insights.themes.reduce((n, t) => n + t.answered, 0);
        expect(themed).toBeLessThanOrEqual(insights.answered);
        expect(insights.answered).toBeLessThanOrEqual(insights.items);
        expect(Object.values(insights.counts).reduce((a, b) => a + b, 0)).toBe(insights.answered);
      })
    );
  });

  it("IN-3: group order, item order and notes never change scores or the animal", () => {
    fc.assert(
      fc.property(menuArb, (menu) => {
        const base = menuInsights(menu);
        const moved = menuInsights(rebuild(menu, reversed));
        expect(moved).toEqual(base);
        const noNotes = menuInsights(rebuild(menu, same, ({ note: _note, ...item }) => item));
        expect(noNotes.themes).toEqual(base.themes);
        expect(noNotes.animal).toEqual(base.animal);
      })
    );
  });

  it("IN-4: hatching below HATCH_AT answers; otherwise the best-scoring theme, or the Chameleon", () => {
    fc.assert(
      fc.property(menuArb, (menu) => {
        const { animal, answered, themes } = menuInsights(menu);
        if (answered < HATCH_AT) {
          expect(animal).toEqual({ kind: "hatching", needed: HATCH_AT - answered });
          return;
        }
        expect(animal.kind).toBe("animal");
        if (animal.kind !== "animal") return;
        const ranked = rankThemes(themes);
        if (ranked.length === 0) expect(animal.theme).toBeNull();
        else {
          const best = Math.max(...ranked.map((t) => t.score as number));
          expect(themes.find((t) => t.theme === animal.theme)?.score).toBe(best);
        }
        if (animal.streak) expect(animal.streak).not.toBe(animal.theme);
      })
    );
  });

  it("IN-6: the same menu always gives the same result, and the menu isn't changed", () => {
    fc.assert(
      fc.property(menuArb, (menu) => {
        const before = JSON.stringify(Object.entries(menu));
        expect(menuInsights(menu)).toEqual(menuInsights(menu));
        expect(JSON.stringify(Object.entries(menu))).toBe(before);
      })
    );
  });

  it("IN-7: every effort badge is listed; an answer badge only appears once earned", () => {
    fc.assert(
      fc.property(menuArb, (menu) => {
        const { badges } = menuInsights(menu);
        const effort = Object.entries(BADGE_TEXT).filter(([, b]) => b.kind === "effort").map(([id]) => id);
        for (const id of effort) expect(badges.some((b) => b.id === id)).toBe(true);
        for (const badge of badges) {
          if (BADGE_TEXT[badge.id].kind === "answers") expect(badge.earned).toBe(true);
        }
      })
    );
  });
});
