import { countByFilter, filterComparison, itemCategories } from "./compare-filters";
import { MenuComparison } from "./model/compare";

const cats = (...values: Parameters<typeof itemCategories>[0]) =>
  Array.from(itemCategories(values)).sort();

describe("compare filters", () => {
  it("classifies agreement", () => {
    expect(cats("maybe", "maybe")).toEqual(["agree"]);
    expect(cats("must-have", "must-have")).toEqual(["agree", "both-want"]);
    expect(cats("off-limits", "off-limits")).toEqual(["agree"]);
  });

  it("classifies conflicts and differences", () => {
    expect(cats("must-have", "off-limits")).toEqual(["conflict"]);
    expect(cats("like-to-have", "maybe", "off-limits")).toEqual(["conflict"]);
    expect(cats("must-have", "like-to-have")).toEqual(["both-want", "differ"]);
    expect(cats("maybe", "off-limits")).toEqual(["differ"]);
  });

  it("classifies unanswered and missing items", () => {
    expect(cats("must-have", undefined)).toEqual(["unanswered"]);
    expect(cats(null, "maybe")).toEqual(["missing"]);
    // A conflict is still a conflict when a third person hasn't answered.
    expect(cats("must-have", "off-limits", undefined)).toEqual(["conflict", "unanswered"]);
  });

  const comparison: MenuComparison = {
    A: [
      { item: "x", values: ["maybe", "maybe"] },
      { item: "y", values: ["must-have", "off-limits"] },
    ],
    B: [{ item: "z", values: ["like-to-have", "must-have"] }],
  };

  it("counts items per filter", () => {
    expect(countByFilter(comparison)).toMatchObject({
      all: 3,
      agree: 1,
      conflict: 1,
      "both-want": 1,
      differ: 1,
      unanswered: 0,
      missing: 0,
    });
  });

  it("filters items and drops empty groups", () => {
    expect(filterComparison(comparison, "conflict")).toEqual({
      A: [{ item: "y", values: ["must-have", "off-limits"] }],
    });
    expect(filterComparison(comparison, "all")).toBe(comparison);
  });
});
