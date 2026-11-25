// Tests for the data-comparer helper functions in ./data-comparer.ts

import { compareMenus } from "./data-comparer";
import { MenuComparison } from "./model/compare";
import { RelationshipMenu } from "./model/menu";

describe("data-comparer", () => {
  describe("compareMenus", () => {
    it("should compare two menus with identical items", () => {
      const menu1: RelationshipMenu = {
        a: [
          {
            item: "a",
            value: "maybe",
          },
        ],
        b: [
          {
            item: "b",
            value: "like-to-have",
          },
        ],
      };
      const menu2: RelationshipMenu = {
        a: [
          {
            item: "a",
            value: "maybe",
          },
        ],
        b: [
          {
            item: "b",
            value: "like-to-have",
          },
        ],
      };

      const comparison = compareMenus([menu1, menu2]);
      expect(comparison).toEqual({
        a: [
          {
            item: "a",
            values: ["maybe", "maybe"],
          },
        ],
        b: [
          {
            item: "b",
            values: ["like-to-have", "like-to-have"],
          },
        ],
      } as MenuComparison);
    });

    it("should match items by case-insensitive content across menus", () => {
      const menu1: RelationshipMenu = {
        Physical: [
          { item: "Kissing", value: "must-have" },
          { item: "Hugging", value: "like-to-have" },
        ],
      };
      const menu2: RelationshipMenu = {
        Physical: [
          { item: "Hugging", value: "maybe" },
          { item: "Traveling", value: "off-limits" },
        ],
      };

      const comparison = compareMenus([menu1, menu2]);
      expect(comparison).toEqual({
        Physical: [
          { item: "Kissing", values: ["must-have", null] },
          { item: "Hugging", values: ["like-to-have", "maybe"] },
          { item: "Traveling", values: [null, "off-limits"] },
        ],
      } as MenuComparison);
    });

    it("should match items case-insensitively", () => {
      const menu1: RelationshipMenu = {
        a: [{ item: "Hello", value: "must-have" }],
      };
      const menu2: RelationshipMenu = {
        a: [{ item: "hello", value: "maybe" }],
      };

      const comparison = compareMenus([menu1, menu2]);
      expect(comparison).toEqual({
        a: [{ item: "Hello", values: ["must-have", "maybe"] }],
      } as MenuComparison);
    });

    it("should handle groups that only exist in one menu", () => {
      const menu1: RelationshipMenu = {
        Physical: [{ item: "Kissing", value: "must-have" }],
      };
      const menu2: RelationshipMenu = {
        Emotional: [{ item: "Trust", value: "like-to-have" }],
      };

      const comparison = compareMenus([menu1, menu2]);
      expect(comparison).toEqual({
        Physical: [
          { item: "Kissing", values: ["must-have", null] },
        ],
        Emotional: [
          { item: "Trust", values: [null, "like-to-have"] },
        ],
      } as MenuComparison);
    });

    it("should handle three menus with overlapping items", () => {
      const menu1: RelationshipMenu = {
        Values: [
          { item: "Honesty", value: "must-have" },
          { item: "Loyalty", value: "like-to-have" },
        ],
      };
      const menu2: RelationshipMenu = {
        Values: [
          { item: "Honesty", value: "maybe" },
          { item: "Respect", value: "must-have" },
        ],
      };
      const menu3: RelationshipMenu = {
        Values: [
          { item: "Loyalty", value: "off-limits" },
          { item: "Respect", value: "like-to-have" },
        ],
      };

      const comparison = compareMenus([menu1, menu2, menu3]);
      expect(comparison).toEqual({
        Values: [
          { item: "Honesty", values: ["must-have", "maybe", null] },
          { item: "Loyalty", values: ["like-to-have", null, "off-limits"] },
          { item: "Respect", values: [null, "must-have", "like-to-have"] },
        ],
      } as MenuComparison);
    });

    it("should distinguish 'no preference' (undefined) from 'not on this menu' (null)", () => {
      const comparison = compareMenus([
        { Physical: [{ item: "Kissing" }] },
        { Physical: [{ item: "Hugging", value: "maybe" }] },
      ]);
      expect(comparison.Physical).toEqual([
        { item: "Kissing", values: [undefined, null] },
        { item: "Hugging", values: [null, "maybe"] },
      ]);
    });

    it("should match items ignoring extra whitespace and generated item ids", () => {
      const comparison = compareMenus([
        { a: [{ id: "item_1", item: "  Living   together ", value: "maybe" }] },
        { a: [{ id: "item_1", item: "living together", value: "must-have" }] },
      ]);
      expect(comparison.a).toEqual([
        { item: "Living   together", values: ["maybe", "must-have"] },
      ]);
    });

    it("should not merge different items that happen to share a generated id", () => {
      const comparison = compareMenus([
        { a: [{ id: "item_1", item: "Kissing", value: "maybe" }] },
        { a: [{ id: "item_1", item: "Dancing", value: "must-have" }] },
      ]);
      expect(comparison.a).toHaveLength(2);
    });

    it("should match group names case-insensitively", () => {
      const comparison = compareMenus([
        { Physical: [{ item: "Kissing", value: "maybe" }] },
        { physical: [{ item: "kissing", value: "must-have" }] },
      ]);
      expect(comparison).toEqual({
        Physical: [{ item: "Kissing", values: ["maybe", "must-have"] }],
      });
    });

    it("should ignore items with blank text", () => {
      const comparison = compareMenus([
        { a: [{ item: "" }, { item: "   " }, { item: "Trust", value: "maybe" }] },
        { a: [{ item: "Trust", value: "maybe" }] },
      ]);
      expect(comparison.a).toEqual([
        { item: "Trust", values: ["maybe", "maybe"] },
      ]);
    });

    it("should keep every group, even when empty", () => {
      expect(compareMenus([{ Empty: [] }, {}])).toEqual({ Empty: [] });
    });
  });

    it("collects each menu's note without affecting matching (CP-14)", () => {
      const result = compareMenus([
        { G: [{ item: "Kissing", value: "must-have", note: " not in public " }, { item: "Trust" }] },
        { G: [{ item: "kissing", value: "maybe" }, { item: "Trust", note: "always" }] },
      ]);
      expect(result.G).toEqual([
        { item: "Kissing", values: ["must-have", "maybe"], notes: ["not in public", undefined] },
        { item: "Trust", values: [undefined, undefined], notes: [undefined, "always"] },
      ]);
    });
});
