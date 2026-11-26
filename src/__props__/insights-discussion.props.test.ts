/**
 * Property tests for where people stand (CP-22, CP-30..CP-33) and the discussion
 * agenda (DS-2, DS-3) on generated menus.
 */
import fc from "fast-check";
import { compareMenus } from "../data-comparer";
import { countByFilter, itemCategories } from "../compare-filters";
import { Bucket, bucketOf, matchesFocusFilter, ZONES } from "../compare-focus";
import { answerGap, byDifference, compareInsights, differenceScore, flattenComparison } from "../compare-insights";
import { buildAgenda, TopicKind } from "../discussion";
import { menuArb } from "./arbitraries";

const menusArb = fc.array(menuArb, { minLength: 1, maxLength: 3 });
const KIND_ORDER: TopicKind[] = ["celebrate", "explore", "conflict", "check-in"];

describe("where people stand", () => {
  it("CP-30: every item is in exactly one bucket and one zone; every total adds up", () => {
    fc.assert(
      fc.property(menusArb, (menus) => {
        const comparison = compareMenus(menus);
        const items = flattenComparison(comparison);
        const insights = compareInsights(comparison, menus.length);
        expect(insights.total).toBe(items.length);
        expect(Object.values(insights.buckets).reduce((a, b) => a + b, 0)).toBe(items.length);
        expect(Object.values(insights.zones).reduce((a, b) => a + b, 0)).toBe(items.length);
        // Each zone filter shows exactly the items counted in it; the zones never overlap.
        for (const z of ZONES) {
          expect(items.filter((i) => matchesFocusFilter(i, z.id)).length).toBe(insights.zones[z.id]);
        }
        for (const item of items) {
          expect(ZONES.filter((z) => matchesFocusFilter(item, z.id))).toHaveLength(1);
        }
        for (const g of insights.byGroup) {
          expect(Object.values(g.zones).reduce((a, b) => a + b, 0)).toBe(g.total);
        }
        expect(insights.byGroup.reduce((n, g) => n + g.total, 0)).toBe(items.length);
        // The per-group filter counts a conversation's area insights use (CV-4) match the filters.
        const counts = countByFilter(comparison);
        const sum = (k: "agree" | "conflict" | "differ" | "bothWant") => insights.byGroup.reduce((n, g) => n + g[k], 0);
        expect(sum("agree")).toBe(counts.agree);
        expect(sum("conflict")).toBe(counts.conflict);
        expect(sum("differ")).toBe(counts.differ);
        expect(sum("bothWant")).toBe(counts["both-want"]);
        for (const g of insights.byGroup) {
          if (g.alignment !== null) expect(g.alignment >= 0 && g.alignment <= 1).toBe(true);
        }
        for (const p of insights.people) {
          expect(p.mustHave + p.likeToHave + p.maybe + p.offLimits + p.unanswered + p.notOnMenu).toBe(items.length);
        }
      })
    );
  });

  it("CP-31: buckets agree with the verified filters", () => {
    fc.assert(
      fc.property(menusArb, (menus) => {
        for (const item of flattenComparison(compareMenus(menus))) {
          const c = itemCategories(item.values);
          const b = bucketOf(item.values);
          expect(b === "conflict").toBe(c.has("conflict"));
          if (b === "open") expect(c.has("unanswered") || c.has("missing")).toBe(true);
          if (b === "shared-want" || b === "shared-maybe" || b === "shared-no") expect(c.has("agree")).toBe(true);
          if (b === "shared-want" || b === "degree") expect(c.has("both-want")).toBe(true);
          if (b === "degree" || b === "talk") expect(c.has("differ")).toBe(true);
          if (b === "talk") expect(c.has("both-want")).toBe(false);
        }
      })
    );
  });

  it("CP-32: the focus list is exactly the conflicts, differences and open items, conflicts first, then by gap", () => {
    fc.assert(
      fc.property(menusArb, (menus) => {
        const comparison = compareMenus(menus);
        const { focus } = compareInsights(comparison, menus.length);
        const expected = flattenComparison(comparison).filter((i) => ["conflict", "talk", "open"].includes(bucketOf(i.values)));
        expect(new Set(focus)).toEqual(new Set(expected));
        expect(focus).toHaveLength(expected.length);
        const rank = (b: Bucket) => ({ conflict: 3, talk: 2, open: 1 })[b as "conflict"] ?? 0;
        for (let i = 1; i < focus.length; i++) {
          const a = rank(bucketOf(focus[i - 1].values));
          const b = rank(bucketOf(focus[i].values));
          expect(a).toBeGreaterThanOrEqual(b);
          if (a === b) expect(answerGap(focus[i - 1].values) ?? 0).toBeGreaterThanOrEqual(answerGap(focus[i].values) ?? 0);
        }
      })
    );
  });

  it("CP-33: each person's unshared must-haves and wanted limits are exactly that", () => {
    fc.assert(
      fc.property(menusArb, (menus) => {
        const comparison = compareMenus(menus);
        const items = flattenComparison(comparison);
        const { people } = compareInsights(comparison, menus.length);
        const yes = (v: unknown) => v === "must-have" || v === "like-to-have";
        people.forEach((p, m) => {
          const others = (i: (typeof items)[number]) => i.values.filter((_, j) => j !== m);
          const must = items.filter((i) => i.values[m] === "must-have" && others(i).some((v) => !yes(v)));
          const limits = items.filter((i) => i.values[m] === "off-limits" && others(i).some(yes));
          expect(new Set(p.mustNotShared)).toEqual(new Set(must));
          expect(p.mustNotShared).toHaveLength(must.length);
          expect(new Set(p.limitsWanted)).toEqual(new Set(limits));
          expect(p.limitsWanted).toHaveLength(limits.length);
        });
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
