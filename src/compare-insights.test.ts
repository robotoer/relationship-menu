import { answerGap, byDifference, byFocus, compareInsights, differenceScore, flattenComparison, matchesQuery } from "./compare-insights";
import { bucketOf, matchesFocusFilter } from "./compare-focus";
import { compareMenus } from "./data-comparer";

const comparison = compareMenus([
  {
    Touch: [
      { item: "Kissing", value: "must-have" },
      { item: "Cuddling", value: "like-to-have" },
      { item: "Dancing", value: "maybe" },
      { item: "Hugging", value: "must-have" },
    ],
    Future: [
      { item: "Kids", value: "must-have", note: "two, someday" },
      { item: "Marriage" },
      { item: "Pets", value: "off-limits" },
    ],
  },
  {
    Touch: [
      { item: "Kissing", value: "must-have" },
      { item: "Cuddling", value: "maybe" },
      { item: "Dancing", value: "maybe" },
      { item: "Hugging", value: "like-to-have" },
    ],
    Future: [
      { item: "Kids", value: "off-limits" },
      { item: "Pets", value: "off-limits" },
    ],
  },
]);

describe("bucketOf (CP-30, CP-31)", () => {
  it("puts each item in the one bucket that says where people stand", () => {
    expect(bucketOf(["must-have", "off-limits"])).toBe("conflict");
    expect(bucketOf(["like-to-have", "off-limits", undefined])).toBe("conflict");
    expect(bucketOf(["must-have", "maybe"])).toBe("talk");
    expect(bucketOf(["maybe", "off-limits"])).toBe("talk");
    expect(bucketOf(["must-have", undefined])).toBe("open");
    expect(bucketOf(["must-have", null])).toBe("open");
    expect(bucketOf(["must-have", "like-to-have"])).toBe("degree");
    expect(bucketOf(["maybe", "maybe"])).toBe("shared-maybe");
    expect(bucketOf(["like-to-have", "like-to-have"])).toBe("shared-want");
    expect(bucketOf(["off-limits", "off-limits"])).toBe("shared-no");
    expect(bucketOf([])).toBe("open");
  });

  it("filters by zone, and by notes", () => {
    const items = flattenComparison(comparison);
    const names = (f: Parameters<typeof matchesFocusFilter>[1]) =>
      items.filter((i) => matchesFocusFilter(i, f)).map((i) => i.item);
    expect(names("conflict")).toEqual(["Kids"]);
    expect(names("talk")).toEqual(["Cuddling"]);
    expect(names("open")).toEqual(["Marriage"]);
    expect(names("quick")).toEqual(["Dancing", "Hugging"]);
    expect(names("aligned")).toEqual(["Kissing", "Pets"]);
    expect(names("notes")).toEqual(["Kids"]);
    expect(names("all")).toHaveLength(7);
  });
});

describe("answerGap and differenceScore", () => {
  it("measures how far apart answers are, ignoring missing ones", () => {
    expect(answerGap(["must-have", "off-limits"])).toBe(3);
    expect(answerGap(["like-to-have", "maybe"])).toBe(1);
    expect(answerGap(["maybe", "maybe"])).toBe(0);
    expect(answerGap(["must-have", null])).toBeNull();
    expect(answerGap(["must-have", undefined, "maybe"])).toBe(2);
  });

  it("ranks conflicts above any non-conflict difference, and uncomparable items last", () => {
    expect(differenceScore(["like-to-have", "off-limits"])).toBeGreaterThan(differenceScore(["must-have", "maybe"]));
    expect(differenceScore(["must-have", null])).toBe(-1);
  });
});

describe("compareInsights (CP-30..CP-33)", () => {
  const insights = compareInsights(comparison, 2);

  it("counts every item once, by bucket and by zone", () => {
    expect(insights.total).toBe(7);
    expect(insights.zones).toEqual({ conflict: 1, talk: 1, open: 1, quick: 2, aligned: 2 });
    expect(insights.buckets).toMatchObject({ degree: 1, "shared-maybe": 1, "shared-want": 1, "shared-no": 1 });
    expect(insights.withNotes).toBe(1);
  });

  it("lists what to talk about first: conflicts, then differences, then open items", () => {
    expect(insights.focus.map((i) => i.item)).toEqual(["Kids", "Cuddling", "Marriage"]);
  });

  it("lists shared wants and shared limits", () => {
    expect(insights.sharedWants.map((i) => i.item)).toEqual(["Kissing"]);
    expect(insights.sharedLimits.map((i) => i.item)).toEqual(["Pets"]);
  });

  it("summarises each group by zone", () => {
    expect(insights.byGroup).toEqual([
      {
        group: "Touch",
        total: 4,
        zones: { conflict: 0, talk: 1, open: 0, quick: 2, aligned: 1 },
        agree: 2,
        bothWant: 2,
        conflict: 0,
        differ: 2,
        open: 0,
        alignment: 0.5,
      },
      {
        group: "Future",
        total: 3,
        zones: { conflict: 1, talk: 0, open: 1, quick: 0, aligned: 1 },
        agree: 1,
        bothWant: 0,
        conflict: 1,
        differ: 0,
        open: 1,
        alignment: 0.5,
      },
    ]);
  });

  it("shows what matters most to each person, and how the other answered", () => {
    const [ana, ben] = insights.people;
    expect(ana).toMatchObject({ mustHave: 3, likeToHave: 1, maybe: 1, offLimits: 1, unanswered: 1, notOnMenu: 0 });
    // Kissing is shared; Hugging is a Like to have for Ben, still a yes; Kids is an Off limits.
    expect(ana.mustNotShared.map((i) => i.item)).toEqual(["Kids"]);
    expect(ana.limitsWanted).toEqual([]);
    expect(ben.limitsWanted.map((i) => i.item)).toEqual(["Kids"]);
    expect(ben.notOnMenu).toBe(1);
  });

  it("handles an empty comparison", () => {
    const empty = compareInsights({}, 2);
    expect(empty.total).toBe(0);
    expect(empty.focus).toEqual([]);
    expect(empty.people).toHaveLength(2);
  });
});

describe("byDifference, byFocus and matchesQuery", () => {
  it("sorts by difference, keeping menu order for ties", () => {
    expect(byDifference(flattenComparison(comparison)).map((i) => i.item)).toEqual([
      "Kids",
      "Cuddling",
      "Hugging",
      "Kissing",
      "Dancing",
      "Pets",
      "Marriage",
    ]);
  });

  it("puts items with notes first among equals", () => {
    const tie = compareMenus([
      { G: [{ item: "A", value: "must-have" }, { item: "B", value: "must-have", note: "why" }] },
      { G: [{ item: "A", value: "maybe" }, { item: "B", value: "maybe" }] },
    ]);
    expect(byFocus(flattenComparison(tie)).map((i) => i.item)).toEqual(["B", "A"]);
  });

  it("searches item text, group name and notes, ignoring case", () => {
    const items = flattenComparison(comparison);
    expect(items.filter((i) => matchesQuery(i, "SOMEDAY")).map((i) => i.item)).toEqual(["Kids"]);
    expect(items.filter((i) => matchesQuery(i, "touch"))).toHaveLength(4);
    expect(items.filter((i) => matchesQuery(i, "  "))).toHaveLength(7);
  });
});
