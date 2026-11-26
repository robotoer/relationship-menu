/**
 * Property tests for applyMenuChange, one per lemma in
 * docs/spec/formal/dafny/MenuEditing.dfy (rule IDs from docs/spec/README.md §3).
 * Group order = Object.keys order; an item is compared by (text, answer).
 */
import fc from "fast-check";
import { applyMenuChange, MenuChange } from "../menu-editing";
import { RelationshipMenu, RelationshipMenuItem } from "../model/menu";
import { answerArb, menuArb, textArb } from "./arbitraries";

const RUNS = { numRuns: 300 };
const own = (m: object, k: string) => Object.prototype.hasOwnProperty.call(m, k);
const keys = (m: RelationshipMenu) => Object.keys(m);
const fold = (s: string) => s.trim().toLowerCase();
/** JS orders array-index keys ("0", "17") before all others, whatever the insertion order. */
const isIndexKey = (s: string) => /^(0|[1-9]\d*)$/.test(s) && Number(s) < 2 ** 32 - 1;
/** Ordering properties hold only without index-like names (see deviations block). */
const orderable = (m: RelationshipMenu, ...names: string[]) =>
  fc.pre(![...keys(m), ...names].some(isIndexKey));
const itemKey = (i: RelationshipMenuItem) => JSON.stringify([i.item, i.value ?? null]);

let counter = 0;
const gen = () => `gen_${++counter}`;

/** Multiset inclusion of (text, answer) pairs. */
const includes = (big: RelationshipMenuItem[], small: RelationshipMenuItem[]) => {
  const count = new Map<string, number>();
  for (const i of big) count.set(itemKey(i), (count.get(itemKey(i)) ?? 0) + 1);
  return small.every((i) => {
    const n = count.get(itemKey(i)) ?? 0;
    count.set(itemKey(i), n - 1);
    return n > 0;
  });
};
const sameMultiset = (a: RelationshipMenuItem[], b: RelationshipMenuItem[]) =>
  a.length === b.length && includes(a, b);

/** A group name: usually an existing one, sometimes any text. */
const nameIn = (m: RelationshipMenu) =>
  keys(m).length ? fc.oneof(fc.constantFrom(...keys(m)), textArb) : textArb;
const indexArb = fc.integer({ min: -2, max: 7 });
const dirArb = fc.constantFrom(-1, 1);
const patchArb = fc.record(
  { item: textArb, value: fc.option(answerArb, { nil: undefined }), id: fc.constantFrom("x1", "") },
  { requiredKeys: [] }
);

const changeArb = (m: RelationshipMenu): fc.Arbitrary<MenuChange> =>
  fc.oneof(
    textArb.map((newGroup) => ({ kind: "group" as const, newGroup })),
    fc.tuple(nameIn(m), textArb).map(([oldGroup, newGroup]) => ({ kind: "group" as const, oldGroup, newGroup })),
    fc.tuple(nameIn(m), nameIn(m)).map(([oldGroup, newGroup]) => ({ kind: "group" as const, oldGroup, newGroup })),
    nameIn(m).map((oldGroup) => ({ kind: "group" as const, oldGroup })),
    fc.tuple(nameIn(m), indexArb, patchArb).map(([group, itemIndex, value]) => ({ kind: "item" as const, group, itemIndex, value })),
    fc.tuple(nameIn(m), indexArb).map(([group, itemIndex]) => ({ kind: "item" as const, group, itemIndex })),
    fc.tuple(nameIn(m), indexArb, dirArb).map(([group, itemIndex, offset]) => ({ kind: "move-item" as const, group, itemIndex, offset })),
    fc.tuple(nameIn(m), dirArb).map(([group, offset]) => ({ kind: "move-group" as const, group, offset })),
    fc.tuple(nameIn(m), fc.array(textArb, { maxLength: 5 })).map(([group, items]) => ({ kind: "insert-group" as const, group, items })),
    fc.tuple(nameIn(m), indexArb).map(([group, itemIndex]) => ({ kind: "item-to-group" as const, group, itemIndex })),
    menuArb.map((menu) => ({ kind: "replace" as const, menu }))
  );

const caseArb = menuArb.chain((m) => fc.tuple(fc.constant(m), changeArb(m)));
const withGroup = (f: (m: RelationshipMenu, g: string) => fc.Arbitrary<MenuChange>) =>
  menuArb
    .filter((m) => keys(m).length > 0)
    .chain((m) => fc.constantFrom(...keys(m)).chain((g) => fc.tuple(fc.constant(m), f(m, g))));

/** Mirrors the model's RenamedName: only an effective rename changes a name. */
const renamed = (m: RelationshipMenu, c: MenuChange, name: string) =>
  c.kind === "group" && c.oldGroup === name && c.newGroup !== undefined &&
  c.newGroup !== name && !own(m, c.newGroup)
    ? c.newGroup
    : name;

const lossy = (c: MenuChange) =>
  c.kind === "replace" ||
  (c.kind === "group" && c.oldGroup !== undefined && c.newGroup === undefined) ||
  (c.kind === "item" && c.value === undefined);

describe("applyMenuChange properties (mirrors MenuEditing.dfy)", () => {
  it("DM-1: no edit merges or drops groups except delete/replace (names stay unique)", () => {
    fc.assert(
      fc.property(caseArb, ([m, c]) => {
        const r = applyMenuChange(m, c, gen);
        expect(new Set(keys(r)).size).toBe(keys(r).length);
        if (c.kind === "replace") return;
        const delta = keys(r).length - keys(m).length;
        const isDelete = c.kind === "group" && c.oldGroup !== undefined && c.newGroup === undefined;
        expect(delta).toBeGreaterThanOrEqual(isDelete ? -1 : 0);
        expect(delta).toBeLessThanOrEqual(isDelete ? 0 : 1);
      }),
      RUNS
    );
  });

  it("ED-1: add group appends at the end or is a no-op", () => {
    fc.assert(
      fc.property(menuArb, fc.oneof(textArb, menuArb.map((x) => keys(x)[0] ?? "")), (m, n) => {
        orderable(m, n);
        const r = applyMenuChange(m, { kind: "group", newGroup: n }, gen);
        if (n === "" || own(m, n)) return void expect(r).toBe(m);
        expect(keys(r)).toEqual([...keys(m), n]);
        expect(r[n]).toEqual([]);
        for (const k of keys(m)) expect(r[k]).toBe(m[k]);
      }),
      RUNS
    );
  });

  it("ED-2: rename keeps position and items; onto an existing name is a no-op", () => {
    fc.assert(
      fc.property(
        withGroup((m, g) =>
          fc.oneof(nameIn(m), fc.constant("")).map((n) => ({ kind: "group" as const, oldGroup: g, newGroup: n }))
        ),
        ([m, c]) => {
          const { oldGroup: o, newGroup: n } = c as { oldGroup: string; newGroup: string };
          orderable(m, n);
          const r = applyMenuChange(m, c, gen);
          if (own(m, n)) return void expect(r).toBe(m);
          expect(keys(r)).toEqual(keys(m).map((k) => (k === o ? n : k)));
          expect(r[n]).toBe(m[o]);
        }
      ),
      RUNS
    );
  });

  it("ED-3: only delete-group removes a group; it removes exactly that one", () => {
    fc.assert(
      fc.property(caseArb, ([m, c]) => {
        const r = applyMenuChange(m, c, gen);
        if (c.kind === "replace") return;
        if (c.kind === "group" && c.oldGroup !== undefined && c.newGroup === undefined) {
          expect(keys(r)).toEqual(keys(m).filter((k) => k !== c.oldGroup));
          return;
        }
        for (const k of keys(m)) expect(own(r, renamed(m, c, k))).toBe(true);
      }),
      RUNS
    );
  });

  it("ED-4: add item appends to the group with a fresh id", () => {
    fc.assert(
      fc.property(
        withGroup((m, g) => patchArb.map((value) => ({ kind: "item" as const, group: g, itemIndex: m[g].length, value }))),
        ([m, c]) => {
          const { group: g, value } = c as { group: string; value: Partial<RelationshipMenuItem> };
          const before = counter;
          const r = applyMenuChange(m, c, gen);
          expect(keys(r)).toEqual(keys(m));
          expect(r[g].slice(0, -1)).toEqual(m[g]);
          const added = r[g][r[g].length - 1];
          expect(added.item).toBe(value.item ?? "");
          expect(added.value).toBe(value.value);
          expect(added.id).toBe(value.id || `gen_${before + 1}`);
          for (const k of keys(m)) if (k !== g) expect(r[k]).toBe(m[k]);
        }
      ),
      RUNS
    );
  });

  it("ED-5: updating an item changes only the given fields", () => {
    fc.assert(
      fc.property(
        withGroup((m, g) =>
          fc.tuple(fc.integer({ min: 0, max: Math.max(0, m[g].length - 1) }), patchArb).map(([itemIndex, value]) => ({
            kind: "item" as const, group: g, itemIndex, value,
          }))
        ).filter(([m, c]) => (c as { itemIndex: number }).itemIndex < m[(c as { group: string }).group].length),
        ([m, c]) => {
          const { group: g, itemIndex: k, value } = c as { group: string; itemIndex: number; value: Partial<RelationshipMenuItem> };
          const r = applyMenuChange(m, c, gen);
          const before = m[g][k];
          const after = r[g][k];
          expect(keys(r)).toEqual(keys(m));
          expect(r[g].length).toBe(m[g].length);
          r[g].forEach((x, q) => q !== k && expect(x).toBe(m[g][q]));
          expect(after.item).toBe("item" in value ? value.item : before.item);
          expect(after.value).toBe("value" in value ? value.value : before.value);
          for (const key of keys(m)) if (key !== g) expect(r[key]).toBe(m[key]);
        }
      ),
      RUNS
    );
  });

  it("ED-6: delete item removes exactly that item (or is a no-op)", () => {
    fc.assert(
      fc.property(
        withGroup((m, g) => indexArb.map((itemIndex) => ({ kind: "item" as const, group: g, itemIndex }))),
        ([m, c]) => {
          const { group: g, itemIndex: k } = c as { group: string; itemIndex: number };
          const r = applyMenuChange(m, c, gen);
          if (k < 0 || k >= m[g].length) return void expect(r).toBe(m);
          expect(keys(r)).toEqual(keys(m));
          expect(r[g]).toEqual([...m[g].slice(0, k), ...m[g].slice(k + 1)]);
        }
      ),
      RUNS
    );
  });

  it("ED-7: move item swaps neighbours or is a no-op, and is a permutation", () => {
    fc.assert(
      fc.property(
        withGroup((m, g) => fc.tuple(indexArb, dirArb).map(([itemIndex, offset]) => ({ kind: "move-item" as const, group: g, itemIndex, offset }))),
        ([m, c]) => {
          const { group: g, itemIndex: k, offset } = c as { group: string; itemIndex: number; offset: number };
          const r = applyMenuChange(m, c, gen);
          const to = k + offset;
          if (k < 0 || k >= m[g].length || to < 0 || to >= m[g].length) return void expect(r).toBe(m);
          const swapped = [...m[g]];
          [swapped[k], swapped[to]] = [swapped[to], swapped[k]];
          expect(keys(r)).toEqual(keys(m));
          expect(r[g]).toEqual(swapped);
          expect(sameMultiset(r[g], m[g])).toBe(true);
        }
      ),
      RUNS
    );
  });

  it("ED-7: move group swaps neighbours or is a no-op, and is a permutation", () => {
    fc.assert(
      fc.property(
        caseArb.chain(([m]) => fc.tuple(fc.constant(m), nameIn(m), dirArb)),
        ([m, g, offset]) => {
          orderable(m, g);
          const r = applyMenuChange(m, { kind: "move-group", group: g, offset }, gen);
          const names = keys(m);
          const i = names.indexOf(g);
          const to = i + offset;
          if (i < 0 || to < 0 || to >= names.length) return void expect(r).toBe(m);
          [names[i], names[to]] = [names[to], names[i]];
          expect(keys(r)).toEqual(names);
          for (const k of names) expect(r[k]).toBe(m[k]);
        }
      ),
      RUNS
    );
  });

  it("ED-8: insert-group only appends missing items and never touches existing ones", () => {
    fc.assert(
      fc.property(
        caseArb.chain(([m]) => fc.tuple(fc.constant(m), nameIn(m), fc.array(textArb, { maxLength: 6 }))),
        ([m, g, texts]) => {
          orderable(m, g);
          const r = applyMenuChange(m, { kind: "insert-group", group: g, items: texts }, gen);
          const existing = own(m, g) ? m[g] : [];
          if (fold(g) === "") {
            expect(r).toBe(m); // blank names are ignored
            return;
          }
          const have = new Set(existing.map((x) => fold(x.item)));
          const expected = texts.filter((t) => {
            const f = fold(t);
            if (f === "" || have.has(f)) return false;
            have.add(f); // repeats within `texts` are skipped too
            return true;
          });
          if (own(m, g) && expected.length === 0) {
            expect(r).toBe(m); // ED-10
            return;
          }
          expect(keys(r)).toEqual(own(m, g) ? keys(m) : [...keys(m), g]);
          for (const k of keys(m)) if (k !== g) expect(r[k]).toBe(m[k]);
          existing.forEach((x, q) => expect(r[g][q]).toBe(x));
          const added = r[g].slice(existing.length);
          expect(added.map((x) => x.item)).toEqual(expected);
          added.forEach((x) => expect(x.value).toBeUndefined());
        }
      ),
      RUNS
    );
  });

  it("ED-9: replace returns the given menu", () => {
    fc.assert(
      fc.property(menuArb, menuArb, (m, n) => {
        expect(applyMenuChange(m, { kind: "replace", menu: n }, gen)).toBe(n);
      }),
      RUNS
    );
  });

  it("ED-10: the input is never mutated, and no-op edits return the identical object", () => {
    const deepFreeze = (m: RelationshipMenu) => {
      for (const k of keys(m)) {
        m[k].forEach((x) => Object.freeze(x));
        Object.freeze(m[k]);
      }
      return Object.freeze(m);
    };
    const snapshot = (m: RelationshipMenu) => JSON.stringify(keys(m).map((k) => [k, m[k]]));
    fc.assert(
      fc.property(caseArb, ([m, c]) => {
        const before = snapshot(m);
        const r = applyMenuChange(deepFreeze(m), c, gen);
        expect(snapshot(m)).toBe(before);
        // Edits that change nothing must return the same object (no empty undo step).
        if (c.kind !== "replace" && snapshot(r) === before) {
          expect(r).toBe(m);
        }
      }),
      RUNS
    );
  });

  it("ED-14: make-into-group adds one group right after, holding exactly the item; else a no-op", () => {
    fc.assert(
      fc.property(
        withGroup((m, g) => fc.tuple(fc.constant(g), indexArb).map(([group, itemIndex]) => ({ kind: "item-to-group" as const, group, itemIndex }))),
        ([m, c]) => {
          if (c.kind !== "item-to-group") return;
          const r = applyMenuChange(m, c, gen);
          const item = m[c.group][c.itemIndex];
          const name = item ? item.item.trim() : "";
          if (!item || !name || own(m, name)) {
            expect(r).toBe(m);
            return;
          }
          orderable(m, name);
          const before = keys(m);
          const at = before.indexOf(c.group);
          expect(keys(r)).toEqual([...before.slice(0, at + 1), name, ...before.slice(at + 1)]);
          expect(r[name]).toEqual([item]);
          expect(r[c.group]).toEqual(m[c.group].filter((_, q) => q !== c.itemIndex));
          for (const k of before) if (k !== c.group) expect(r[k]).toBe(m[k]);
          // Nothing lost or duplicated across the whole menu.
          expect(sameMultiset(Object.values(r).flat(), Object.values(m).flat())).toBe(true);
        }
      ),
      RUNS
    );
  });

  it("ED-11: no silent loss — every item survives (under its group's new name) except for delete/replace", () => {
    fc.assert(
      fc.property(caseArb, ([m, c]) => {
        if (lossy(c)) return;
        const r = applyMenuChange(m, c, gen);
        for (const k of keys(m)) {
          const target = renamed(m, c, k);
          expect(own(r, target)).toBe(true);
          let protectedItems = m[k];
          if (c.kind === "item" && c.group === k && c.itemIndex >= 0 && c.itemIndex < m[k].length) {
            protectedItems = m[k].filter((_, q) => q !== c.itemIndex); // the edited item, ED-5
          }
          if (c.kind === "item-to-group" && c.group === k && r !== m) {
            // The moved item leaves its group... but is the first item of the new group.
            const moved = m[k][c.itemIndex];
            protectedItems = m[k].filter((_, q) => q !== c.itemIndex);
            expect(r[moved.item.trim()][0]).toBe(moved);
          }
          expect(includes(r[target], protectedItems)).toBe(true);
        }
      }),
      RUNS
    );
  });

  it("ED-12: __proto__, constructor and friends behave exactly like ordinary names", () => {
    const tricky = ["__proto__", "constructor", "toString", "hasOwnProperty", "valueOf", ""];
    const plain = ["n0", "n1", "n2", "n3", "n4", "n5"];
    const build = (names: string[], idx: number[], items: RelationshipMenuItem[][], proto: boolean) => {
      const m: RelationshipMenu = proto ? {} : Object.create(null);
      idx.forEach((i, j) =>
        Object.defineProperty(m, names[i], { value: items[j], enumerable: true, writable: true, configurable: true })
      );
      return m;
    };
    const rename = (c: MenuChange, to: (s: string) => string): MenuChange => {
      switch (c.kind) {
        case "group":
          return { ...c, ...(c.oldGroup !== undefined && { oldGroup: to(c.oldGroup) }), ...(c.newGroup !== undefined && { newGroup: to(c.newGroup) }) };
        case "replace":
          return c;
        default:
          return { ...c, group: to(c.group) } as MenuChange;
      }
    };
    const slot = fc.integer({ min: 0, max: 5 });
    const arb = fc.record({
      idx: fc.uniqueArray(slot, { maxLength: 4 }),
      items: fc.array(fc.array(fc.record({ item: textArb }), { maxLength: 3 }), { minLength: 4, maxLength: 4 }),
      proto: fc.boolean(),
      g: slot,
      h: slot,
      k: indexArb,
      off: dirArb,
      texts: fc.array(textArb, { maxLength: 3 }),
      which: fc.integer({ min: 0, max: 8 }),
    });
    fc.assert(
      fc.property(arb, ({ idx, items, proto, g, h, k, off, texts, which }) => {
        // Ordinary names: edits only target existing groups, as the editor does.
        const target = idx.length ? idx[g % idx.length] : g;
        const n = (i: number) => plain[i];
        const changes: MenuChange[] = [
          { kind: "group", newGroup: n(h) },
          { kind: "group", oldGroup: n(target), newGroup: n(h) },
          { kind: "group", oldGroup: n(target) },
          { kind: "item", group: n(target), itemIndex: k, value: { item: "x" } },
          { kind: "item", group: n(target), itemIndex: k },
          { kind: "move-item", group: n(target), itemIndex: k, offset: off },
          { kind: "move-group", group: n(target), offset: off },
          { kind: "insert-group", group: n(h), items: texts },
          { kind: "item", group: n(target), itemIndex: 0, value: { item: "y", id: "i" } },
        ];
        const c = changes[which];
        if (!idx.length && c.kind !== "insert-group" && !(c.kind === "group" && c.oldGroup === undefined)) return;
        // "" is ignored by add-group by design (ED-1), so keep it out of that comparison.
        if (c.kind === "group" && c.oldGroup === undefined && tricky[h] === "") return;
        if (c.kind === "insert-group" && tricky[h].trim() === "") return; // same for insert-group (ED-8)
        const toTricky = (s: string) => tricky[plain.indexOf(s)];
        const a = applyMenuChange(build(plain, idx, items, proto), c, () => "id");
        const b = applyMenuChange(build(tricky, idx, items, proto), rename(c, toTricky), () => "id");
        expect(keys(b)).toEqual(keys(a).map(toTricky));
        for (const key of keys(a)) expect(own(b, toTricky(key)) && b[toTricky(key)]).toEqual(a[key]);
      }),
      RUNS
    );
  });

  describe("regressions found by these properties (fixed)", () => {
    it("KL-1: a move-group that can't change JS key order returns the same menu (no empty undo step)", () => {
      const added = applyMenuChange({ Kissing: [] }, { kind: "group", newGroup: "0" }, gen);
      expect(keys(added)).toEqual(["0", "Kissing"]); // known limitation: digits-only names sort first
      const moved = applyMenuChange(added, { kind: "move-group", group: "0", offset: 1 }, gen);
      expect(moved).toBe(added);
    });

    it("ED-10: updating an item to identical values returns the same menu", () => {
      const m: RelationshipMenu = { A: [{ item: "x", value: "maybe" }] };
      expect(applyMenuChange(m, { kind: "item", group: "A", itemIndex: 0, value: {} }, gen)).toBe(m);
      expect(applyMenuChange(m, { kind: "item", group: "A", itemIndex: 0, value: { item: "x", value: "maybe" } }, gen)).toBe(m);
    });

    it("ED-10: insert-group with nothing to add into an existing empty group returns the same menu", () => {
      const m: RelationshipMenu = { A: [] };
      expect(applyMenuChange(m, { kind: "insert-group", group: "A", items: [" "] }, gen)).toBe(m);
    });

    it("ED-12: an item edit naming a missing group 'constructor' is a no-op, not a crash", () => {
      const m: RelationshipMenu = { A: [] };
      expect(applyMenuChange(m, { kind: "item", group: "constructor", itemIndex: 0 }, gen)).toBe(m);
      expect(applyMenuChange(m, { kind: "item", group: "constructor", itemIndex: 0, value: { item: "x" } }, gen)).toBe(m);
    });

    it("ED-8: insert-group skips repeats within its own items and ignores a blank group name", () => {
      const r = applyMenuChange({}, { kind: "insert-group", group: "G", items: ["a", "A", " a "] }, gen);
      expect(r.G.map((x) => x.item)).toEqual(["a"]);
      const m: RelationshipMenu = { A: [] };
      expect(applyMenuChange(m, { kind: "insert-group", group: "  ", items: ["x"] }, gen)).toBe(m);
    });
  });
});

