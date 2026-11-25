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

  describe("ready-made groups", () => {
    it("adds a new group with its items", () => {
      const result = applyMenuChange(
        { A: [] },
        { kind: "insert-group", group: "Finances", items: ["Joint accounts", "Lending money"] },
        gen
      );
      expect(Object.keys(result)).toEqual(["A", "Finances"]);
      expect(result.Finances.map((i) => i.item)).toEqual(["Joint accounts", "Lending money"]);
    });

    it("only appends missing items to an existing group, keeping answers", () => {
      const menu = { Finances: [{ id: "1", item: "joint ACCOUNTS", value: "maybe" as const }] };
      const result = applyMenuChange(
        menu,
        { kind: "insert-group", group: "Finances", items: ["Joint accounts", "Lending money"] },
        gen
      );
      expect(result.Finances).toEqual([
        { id: "1", item: "joint ACCOUNTS", value: "maybe" },
        { id: "generated", item: "Lending money" },
      ]);
      // Nothing new: unchanged.
      expect(
        applyMenuChange(result, { kind: "insert-group", group: "Finances", items: ["Lending money"] }, gen)
      ).toBe(result);
    });
  });

  describe("item-to-group (ED-14)", () => {
    const m: RelationshipMenu = {
      Touch: [
        { id: "1", item: "Kissing", value: "must-have", note: "not in public" },
        { id: "2", item: "Cuddling", value: "maybe" },
      ],
      Later: [{ id: "3", item: "Trust" }],
    };

    it("moves the item into a new group right after its own, keeping text, answer and note", () => {
      const r = applyMenuChange(m, { kind: "item-to-group", group: "Touch", itemIndex: 0 }, gen);
      expect(Object.keys(r)).toEqual(["Touch", "Kissing", "Later"]);
      expect(r.Touch).toEqual([{ id: "2", item: "Cuddling", value: "maybe" }]);
      expect(r.Kissing).toEqual([m.Touch[0]]);
      expect(r.Later).toBe(m.Later);
      expect(m.Touch).toHaveLength(2); // input untouched
    });

    it("uses the trimmed text as the group name", () => {
      const r = applyMenuChange({ G: [{ item: "  Kids  " }] }, { kind: "item-to-group", group: "G", itemIndex: 0 }, gen);
      expect(Object.keys(r)).toEqual(["G", "Kids"]);
    });

    it("is a no-op for blank text, an existing group name, or a missing item/group", () => {
      const blank: RelationshipMenu = { G: [{ item: "  " }] };
      expect(applyMenuChange(blank, { kind: "item-to-group", group: "G", itemIndex: 0 }, gen)).toBe(blank);
      const taken: RelationshipMenu = { G: [{ item: "Later" }], Later: [] };
      expect(applyMenuChange(taken, { kind: "item-to-group", group: "G", itemIndex: 0 }, gen)).toBe(taken);
      expect(applyMenuChange(m, { kind: "item-to-group", group: "Touch", itemIndex: 5 }, gen)).toBe(m);
      expect(applyMenuChange(m, { kind: "item-to-group", group: "constructor", itemIndex: 0 }, gen)).toBe(m);
    });

    it("works for awkward names like __proto__", () => {
      const r = applyMenuChange({ G: [{ item: "__proto__" }] }, { kind: "item-to-group", group: "G", itemIndex: 0 }, gen);
      expect(Object.keys(r)).toEqual(["G", "__proto__"]);
      expect(Object.prototype.hasOwnProperty.call(r, "__proto__")).toBe(true);
    });
  });
});
