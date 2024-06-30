// Tests for the data-comparer helper functions in ./data-comparer.ts

import { compareMenus } from "./data-comparer";
import { MenuComparison } from "./model/compare";
import { RelationshipMenu } from "./model/menu";

describe("data-comparer", () => {
  describe("compareMenus", () => {
    it("should compare two menus", () => {
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
  });
});
