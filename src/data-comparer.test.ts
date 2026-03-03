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
          { item: "Kissing", values: ["must-have", undefined] },
          { item: "Hugging", values: ["like-to-have", "maybe"] },
          { item: "Traveling", values: [undefined, "off-limits"] },
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
          { item: "Kissing", values: ["must-have", undefined] },
        ],
        Emotional: [
          { item: "Trust", values: [undefined, "like-to-have"] },
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
          { item: "Honesty", values: ["must-have", "maybe", undefined] },
          { item: "Loyalty", values: ["like-to-have", undefined, "off-limits"] },
          { item: "Respect", values: [undefined, "must-have", "like-to-have"] },
        ],
      } as MenuComparison);
    });
  });
});
