/**
 * Property tests for comparing menus (spec §7). They run the real code on many
 * generated menus. CP-10/CP-11 are also proved for all inputs in
 * src/answer-cells.ts (LemmaScript); these tests check the app wires them up.
 */
import fc from "fast-check";
import { compareMenus, itemId } from "../data-comparer";
import { countByFilter, filterComparison, itemCategories, COMPARE_FILTERS } from "../compare-filters";
import { ComparedMenuItemValue } from "../model/compare";
import { answerArb, menuArb } from "./arbitraries";

const valueArb: fc.Arbitrary<ComparedMenuItemValue> = fc.oneof(
  answerArb,
  fc.constant(undefined),
  fc.constant(null)
);

/** Naive reference: the comparison as a plain list of (group key, item key, values). */
const reference = (menus: Parameters<typeof compareMenus>[0]) => {
  const rows = new Map<string, ComparedMenuItemValue[]>();
  menus.forEach((menu, m) => {
    for (const [group, items] of Object.entries(menu)) {
      for (const item of items) {
        const key = `${itemId(group)}\u0000${itemId(item.item)}`;
        if (!itemId(item.item)) continue;
        if (!rows.has(key)) rows.set(key, new Array(menus.length).fill(null));
        const values = rows.get(key)!;
        if (!values[m]) values[m] = item.value || undefined;
      }
    }
  });
  return rows;
};

describe("compare properties", () => {
  it("CP-1/CP-5: every non-blank item appears exactly once, matched by normalized text", () => {
    fc.assert(
      fc.property(fc.array(menuArb, { minLength: 1, maxLength: 3 }), (menus) => {
        const comparison = compareMenus(menus);
        const seen = new Map<string, ComparedMenuItemValue[]>();
        for (const [group, items] of Object.entries(comparison)) {
          for (const item of items) {
            const key = `${itemId(group)}\u0000${itemId(item.item)}`;
            expect(seen.has(key)).toBe(false); // exactly once
            seen.set(key, item.values);
          }
        }
        expect(seen).toEqual(reference(menus));
      })
    );
  });

  it("CP-2: each item has exactly one value per menu", () => {
    fc.assert(
      fc.property(fc.array(menuArb, { minLength: 1, maxLength: 4 }), (menus) => {
        for (const items of Object.values(compareMenus(menus))) {
          for (const item of items) expect(item.values).toHaveLength(menus.length);
        }
      })
    );
  });

  it("CP-3: groups and items keep first-seen order", () => {
    fc.assert(
      fc.property(fc.array(menuArb, { minLength: 1, maxLength: 3 }), (menus) => {
        // Known limitation (spec KL-1): JS objects list integer-like keys ("0", "2024")
        // first, so groups named only with digits can't keep first-seen order.
        const isIndexKey = (k: string) => /^(0|[1-9]\d*)$/.test(k);
        fc.pre(menus.every((m) => Object.keys(m).every((g) => !isIndexKey(g))));
        const order: string[] = [];
        for (const menu of menus)
          for (const group of Object.keys(menu))
            if (!order.includes(itemId(group))) order.push(itemId(group));
        expect(Object.keys(compareMenus(menus)).map(itemId)).toEqual(order);
      })
    );
  });

  it("CP-10: a fully answered item is in exactly one of Agree / Talk about it / Conflicts", () => {
    fc.assert(
      fc.property(fc.array(answerArb, { minLength: 1, maxLength: 5 }), (values) => {
        const c = itemCategories(values);
        const verdicts = ["agree", "differ", "conflict"].filter((v) => c.has(v as never));
        expect(verdicts).toHaveLength(1);
      })
    );
  });

  it("CP-11: Agree and Conflicts never overlap; All want implies everyone answered", () => {
    fc.assert(
      fc.property(fc.array(valueArb, { maxLength: 5 }), (values) => {
        const c = itemCategories(values);
        expect(c.has("agree") && c.has("conflict")).toBe(false);
        if (c.has("both-want")) {
          expect(values.length).toBeGreaterThan(0);
          expect(values.every((v) => v === "must-have" || v === "like-to-have")).toBe(true);
        }
        expect(c.has("missing")).toBe(values.includes(null));
        expect(c.has("unanswered")).toBe(values.includes(undefined));
      })
    );
  });

  it("CP-12: each filter shows exactly its matching items, in order, and its count matches", () => {
    fc.assert(
      fc.property(fc.array(menuArb, { minLength: 1, maxLength: 3 }), (menus) => {
        const comparison = compareMenus(menus);
        const counts = countByFilter(comparison);
        for (const { id } of COMPARE_FILTERS) {
          const filtered = filterComparison(comparison, id);
          const shown = Object.values(filtered).flat();
          const expected = Object.values(comparison)
            .flat()
            .filter((item) => id === "all" || itemCategories(item.values).has(id));
          expect(shown).toEqual(expected);
          expect(counts[id]).toBe(shown.length);
          // Filters drop empty groups; "All" shows the comparison unchanged.
          if (id !== "all")
            for (const items of Object.values(filtered)) expect(items.length).toBeGreaterThan(0);
        }
      })
    );
  });
});
