/**
 * Property tests for compare insights (CP-20..CP-23) and the discussion agenda
 * (DS-2, DS-3) on generated menus.
 */
import fc from "fast-check";
import { compareMenus } from "../data-comparer";
import { countByFilter, itemCategories } from "../compare-filters";
import { answerGap, byDifference, compareInsights, differenceScore, flattenComparison } from "../compare-insights";
import { buildAgenda, TopicKind } from "../discussion";
import { menuArb } from "./arbitraries";

const menusArb = fc.array(menuArb, { minLength: 1, maxLength: 3 });
const KIND_ORDER: TopicKind[] = ["celebrate", "explore", "conflict", "check-in"];

describe("insight properties", () => {
  it("CP-20: totals match the filters; per-group and per-person numbers add up", () => {
    fc.assert(
      fc.property(menusArb, (menus) => {
        const comparison = compareMenus(menus);
        const insights = compareInsights(comparison, menus.length);
        const counts = countByFilter(comparison);
        expect(insights.counts).toEqual(counts);
        const sum = (k: "total" | "agree" | "conflict" | "differ" | "bothWant") =>
          insights.byGroup.reduce((n, g) => n + g[k], 0);
        expect(sum("total")).toBe(counts.all);
        expect(sum("agree")).toBe(counts.agree);
        expect(sum("conflict")).toBe(counts.conflict);
        expect(sum("differ")).toBe(counts.differ);
        expect(sum("bothWant")).toBe(counts["both-want"]);
        for (const person of insights.people) {
          expect(Object.values(person).reduce((a, b) => a + b, 0)).toBe(counts.all);
        }
      })
    );
  });

  it("CP-21: alignment is a share between 0 and 1, or null with nothing fully answered", () => {
    fc.assert(
      fc.property(menusArb, (menus) => {
        const insights = compareInsights(compareMenus(menus), menus.length);
        if (insights.fullyAnswered === 0) expect(insights.alignment).toBeNull();
        else {
          expect(insights.alignment).toBeGreaterThanOrEqual(0);
          expect(insights.alignment).toBeLessThanOrEqual(1);
        }
        for (const g of insights.byGroup) {
          if (g.alignment !== null) expect(g.alignment).toBeGreaterThanOrEqual(0);
          if (g.alignment !== null) expect(g.alignment).toBeLessThanOrEqual(1);
        }
      })
    );
  });

  it("CP-22: sorting by difference is a permutation, non-increasing in score, conflicts first", () => {
    fc.assert(
      fc.property(menusArb, (menus) => {
        const items = flattenComparison(compareMenus(menus));
        const sorted = byDifference(items);
        expect(sorted).toHaveLength(items.length);
        expect(new Set(sorted)).toEqual(new Set(items));
        for (let i = 1; i < sorted.length; i++) {
          expect(differenceScore(sorted[i - 1].values)).toBeGreaterThanOrEqual(differenceScore(sorted[i].values));
        }
        const firstNonConflict = sorted.findIndex((x) => !itemCategories(x.values).has("conflict"));
        if (firstNonConflict >= 0) {
          expect(sorted.slice(firstNonConflict).some((x) => itemCategories(x.values).has("conflict"))).toBe(false);
        }
      })
    );
  });

  it("CP-23: top differences are real differences, at most the limit", () => {
    fc.assert(
      fc.property(menusArb, fc.integer({ min: 1, max: 8 }), (menus, limit) => {
        const top = compareInsights(compareMenus(menus), menus.length, limit).topDifferences;
        expect(top.length).toBeLessThanOrEqual(limit);
        for (const item of top) expect(answerGap(item.values)).toBeGreaterThan(0);
      })
    );
  });
});

describe("agenda properties", () => {
  it("DS-2: every conflict, difference and open item is on the agenda exactly once, in kind order", () => {
    fc.assert(
      fc.property(menusArb, (menus) => {
        const comparison = compareMenus(menus);
        const agenda = buildAgenda(comparison);
        const keys = agenda.map((t) => t.key);
        expect(new Set(keys).size).toBe(keys.length);
        const kinds = agenda.map((t) => KIND_ORDER.indexOf(t.kind));
        expect([...kinds].sort((a, b) => a - b)).toEqual(kinds);
        const onAgenda = new Set(agenda.map((t) => `${t.group}\u0000${t.item}`));
        for (const item of flattenComparison(comparison)) {
          const c = itemCategories(item.values);
          if (c.has("conflict") || c.has("differ") || c.has("unanswered") || c.has("missing")) {
            expect(onAgenda.has(`${item.group}\u0000${item.item}`)).toBe(true);
          }
        }
      })
    );
  });

  it("DS-3: at most two shared-ground topics, and each topic has prompts", () => {
    fc.assert(
      fc.property(menusArb, (menus) => {
        const agenda = buildAgenda(compareMenus(menus));
        expect(agenda.filter((t) => t.kind === "celebrate").length).toBeLessThanOrEqual(2);
        for (const t of agenda) expect(t.prompts.length).toBeGreaterThan(0);
      })
    );
  });
});
