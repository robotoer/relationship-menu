import { applyMenuChange } from "./menu-editing";
import { RelationshipMenu } from "./model/menu";

const gen = () => "generated";

describe("applyMenuChange", () => {
  const menu: RelationshipMenu = {
    A: [{ id: "1", item: "Kissing", value: "maybe" }],
    B: [{ id: "2", item: "Trust" }],
    C: [],
  };

  describe("groups", () => {
    it("adds a group at the end", () => {
      const result = applyMenuChange(menu, { kind: "group", newGroup: "D" }, gen);
      expect(Object.keys(result)).toEqual(["A", "B", "C", "D"]);
      expect(result.D).toEqual([]);
    });

    it("does not add a group whose name is already used (keeps its items)", () => {
      const result = applyMenuChange(menu, { kind: "group", newGroup: "A" }, gen);
      expect(result).toBe(menu);
    });

    it("does not add a group with an empty name", () => {
      expect(applyMenuChange(menu, { kind: "group", newGroup: "" }, gen)).toBe(menu);
    });

    it("renames a group in place, keeping its position and items", () => {
      const result = applyMenuChange(
        menu,
        { kind: "group", oldGroup: "A", newGroup: "Physical" },
        gen
      );
      expect(Object.keys(result)).toEqual(["Physical", "B", "C"]);
      expect(result.Physical).toBe(menu.A);
    });

    it("does not rename onto another group's name", () => {
      const result = applyMenuChange(
        menu,
        { kind: "group", oldGroup: "A", newGroup: "B" },
        gen
      );
      expect(result).toBe(menu);
    });

    it("renaming to an empty name keeps the group and its items", () => {
      const result = applyMenuChange(
        menu,
        { kind: "group", oldGroup: "A", newGroup: "" },
        gen
      );
      expect(Object.keys(result)).toEqual(["", "B", "C"]);
      expect(result[""]).toBe(menu.A);
    });

    it("deletes a group only when no new name is given", () => {
      const result = applyMenuChange(menu, { kind: "group", oldGroup: "B" }, gen);
      expect(Object.keys(result)).toEqual(["A", "C"]);
    });

    it("does not mutate the input menu", () => {
      const copy = JSON.parse(JSON.stringify(menu));
      applyMenuChange(menu, { kind: "group", oldGroup: "A", newGroup: "Z" }, gen);
      applyMenuChange(menu, { kind: "group", oldGroup: "A" }, gen);
      expect(menu).toEqual(copy);
    });
  });

  describe("items", () => {
    it("adds an item, using the id it brings", () => {
      const result = applyMenuChange(
        menu,
        { kind: "item", group: "C", itemIndex: 0, value: { item: "H", id: "new_1" } },
        gen
      );
      expect(result.C).toEqual([{ item: "H", id: "new_1" }]);
    });

    it("adds an item with a generated id when none is given", () => {
      const result = applyMenuChange(
        menu,
        { kind: "item", group: "C", itemIndex: 0, value: { value: "maybe" } },
        gen
      );
      expect(result.C).toEqual([{ item: "", value: "maybe", id: "generated" }]);
    });

    it("updates an item", () => {
      const result = applyMenuChange(
        menu,
        { kind: "item", group: "A", itemIndex: 0, value: { item: "Kisses" } },
        gen
      );
      expect(result.A).toEqual([{ id: "1", item: "Kisses", value: "maybe" }]);
    });

    it("deletes an item", () => {
      const result = applyMenuChange(
        menu,
        { kind: "item", group: "A", itemIndex: 0 },
        gen
      );
      expect(result.A).toEqual([]);
    });

    it("ignores edits to missing groups or out-of-range items", () => {
      expect(
        applyMenuChange(menu, { kind: "item", group: "Z", itemIndex: 0, value: {} }, gen)
      ).toBe(menu);
      expect(
        applyMenuChange(menu, { kind: "item", group: "A", itemIndex: 5, value: {} }, gen)
      ).toBe(menu);
    });

    it("applies rapid successive edits without losing any", () => {
      let state: RelationshipMenu = { C: [] };
      for (const ch of "Spring") {
        const items = state.C;
        state = applyMenuChange(
          state,
          items.length === 0
            ? { kind: "item", group: "C", itemIndex: 0, value: { item: ch, id: "x" } }
            : { kind: "item", group: "C", itemIndex: 0, value: { item: items[0].item + ch } },
          gen
        );
      }
      expect(state.C).toEqual([{ item: "Spring", id: "x" }]);
    });
  });

  it("keeps a group named __proto__ when moving or renaming groups", () => {
    const menu = JSON.parse('{"A":[],"__proto__":[{"item":"x"}]}');
    expect(Object.keys(menu)).toEqual(["A", "__proto__"]);
    const moved = applyMenuChange(menu, { kind: "move-group", group: "A", offset: 1 }, gen);
    expect(Object.keys(moved)).toEqual(["__proto__", "A"]);
    expect(moved["__proto__"]).toEqual([{ item: "x" }]);
    const renamed = applyMenuChange(menu, { kind: "group", oldGroup: "A", newGroup: "B" }, gen);
    expect(Object.keys(renamed)).toEqual(["B", "__proto__"]);
  });
});
