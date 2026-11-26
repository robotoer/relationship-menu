import { answerGap, byDifference, compareInsights, differenceScore, flattenComparison, matchesQuery } from "./compare-insights";
import { compareMenus } from "./data-comparer";

const comparison = compareMenus([
  {
    Touch: [
      { item: "Kissing", value: "must-have" },
      { item: "Cuddling", value: "like-to-have" },
      { item: "Dancing", value: "maybe" },
    ],
    Future: [
      { item: "Kids", value: "must-have" },
      { item: "Marriage" },
    ],
  },
  {
    Touch: [
      { item: "Kissing", value: "must-have" },
      { item: "Cuddling", value: "maybe" },
      { item: "Dancing", value: "maybe" },
    ],
    Future: [{ item: "Kids", value: "off-limits" }],
  },
]);

describe("answerGap and differenceScore", () => {
  it("measures how far apart answers are, ignoring missing ones", () => {
    expect(answerGap(["must-have", "off-limits"])).toBe(3);
    expect(answerGap(["like-to-have", "maybe"])).toBe(1);
    expect(answerGap(["maybe", "maybe"])).toBe(0);
    expect(answerGap(["maybe", undefined, null])).toBeNull();
  });

  it("ranks conflicts above any non-conflict difference, and uncomparable items last", () => {
    expect(differenceScore(["must-have", "off-limits"])).toBeGreaterThan(differenceScore(["must-have", "maybe"]));
    expect(differenceScore(["like-to-have", "off-limits"])).toBeGreaterThan(differenceScore(["must-have", "maybe"]));
    expect(differenceScore(["maybe", undefined])).toBe(-1);
  });
});

describe("compareInsights (CP-20..CP-23)", () => {
  const insights = compareInsights(comparison, 2);

  it("counts items the same way the filters do, and computes alignment over fully answered items", () => {
    expect(insights.counts.all).toBe(5);
    expect(insights.counts.conflict).toBe(1);
    expect(insights.fullyAnswered).toBe(4); // Marriage isn't answered by both
    expect(insights.counts.agree).toBe(2); // Kissing, Dancing
    expect(insights.alignment).toBe(0.5);
  });

  it("summarises each group", () => {
    const [touch, future] = insights.byGroup;
    expect(touch).toMatchObject({ group: "Touch", total: 3, agree: 2, differ: 1, conflict: 0, open: 0 });
    expect(touch.alignment).toBeCloseTo(2 / 3);
    expect(future).toMatchObject({ group: "Future", total: 2, conflict: 1, open: 1, alignment: 0 });
  });

  it("profiles each person, in column order", () => {
    expect(insights.people[0]).toEqual({ mustHave: 2, likeToHave: 1, maybe: 1, offLimits: 0, unanswered: 1, notOnMenu: 0 });
    expect(insights.people[1]).toEqual({ mustHave: 1, likeToHave: 0, maybe: 2, offLimits: 1, unanswered: 0, notOnMenu: 1 });
  });

  it("lists the biggest differences, conflicts first, and only real differences", () => {
    expect(insights.topDifferences.map((i) => i.item)).toEqual(["Kids", "Cuddling"]);
  });

  it("handles an empty comparison", () => {
    const empty = compareInsights({}, 2);
    expect(empty.alignment).toBeNull();
    expect(empty.byGroup).toEqual([]);
    expect(empty.topDifferences).toEqual([]);
  });
});

describe("byDifference and matchesQuery", () => {
  it("sorts by difference, keeping menu order for ties", () => {
    expect(byDifference(flattenComparison(comparison)).map((i) => i.item)).toEqual([
      "Kids",
      "Cuddling",
      "Kissing",
      "Dancing",
      "Marriage",
    ]);
  });

  it("searches item text, group name and notes, ignoring case", () => {
    const item = { group: "Touch", item: "Kissing", values: [], notes: ["not in public"] };
    expect(matchesQuery(item, "kiss")).toBe(true);
    expect(matchesQuery(item, "TOUCH")).toBe(true);
    expect(matchesQuery(item, "public")).toBe(true);
    expect(matchesQuery(item, "kids")).toBe(false);
    expect(matchesQuery(item, "  ")).toBe(true);
  });
});
