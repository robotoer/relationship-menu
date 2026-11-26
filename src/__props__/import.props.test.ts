/**
 * Property tests for bringing menus over from the old address without overwriting
 * anything (spec HO-5), and for naming copies (LK-6). They run the REAL planImport
 * and uniqueTitle on random libraries and random incoming menus.
 */
import fc from "fast-check";
import { decodeCompareSlug, encodeMenuSlug } from "../compare-slug";
import { encodeData } from "../data-encoder";
import { IncomingMenu, planImport } from "../import-menus";
import { isNumberedCopyOf, uniqueTitle } from "../menu-titles";
import { RelationshipMenuDocument } from "../model/menu";
import { menuArb } from "./arbitraries";

/** Titles that collide often, including numbered copies and awkward names. */
const titleArb = fc.constantFrom("Us", "Us (2)", "Us (3)", "Them", "", "Untitled (2)", "__proto__", "a (b)", "x (1)");
const personArb = fc.option(fc.record({ name: fc.constantFrom("Sam", "Ari") }), { nil: undefined });

/** A small pool of menus, so identical contents come up often. */
const encodedArb = fc.oneof(
  fc.constantFrom(encodeData({ G: [{ item: "Walks" }] }), encodeData({ G: [{ item: "Walks", value: "must-have" }] })),
  menuArb.map((menu) => encodeData(menu))
);

const docArb: fc.Arbitrary<RelationshipMenuDocument> = fc
  .record({ title: titleArb, encoded: encodedArb, person: personArb })
  .map(({ person, ...doc }) => (person ? { ...doc, person } : doc));

const incomingArb: fc.Arbitrary<IncomingMenu> = fc.oneof(
  { weight: 5, arbitrary: docArb },
  // Junk that slipped through the wire format: must be left out, never saved.
  { weight: 1, arbitrary: fc.record({ title: fc.string(), encoded: fc.constantFrom("AAAA", "bm90IHpsaWI=", "!!") }) }
);

/** What a menu is, for "is it still there?": its decoded content, person and title. */
const contentOf = (m: { title: string; encoded: string; person?: unknown }) => {
  const decoded = decodeCompareSlug(encodeMenuSlug(m.title, m.encoded, m.person as never));
  return decoded ? JSON.stringify([decoded.menu, decoded.person ?? null]) : null;
};

describe("LK-6, HO-5: uniqueTitle", () => {
  it('gives the first free "Title (n)", n ≥ 2, which reads as a copy of the title', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 8 }), fc.uniqueArray(fc.string({ maxLength: 12 }), { maxLength: 20 }), fc.nat(5), (title, others, copies) => {
        const taken = new Set([...others, ...Array.from({ length: copies }, (_, i) => `${title || "Untitled"} (${i + 2})`)]);
        const result = uniqueTitle(title, taken);
        expect(taken.has(result)).toBe(false);
        expect(isNumberedCopyOf(result, title)).toBe(true);
        const n = Number(result.slice(`${title || "Untitled"} (`.length, -1));
        expect(n).toBeGreaterThanOrEqual(2);
        // The smallest free number: every smaller one is taken.
        for (let k = 2; k < n; k++) expect(taken.has(`${title || "Untitled"} (${k})`)).toBe(true);
      })
    );
  });

  it("isNumberedCopyOf only accepts the names uniqueTitle makes", () => {
    expect(isNumberedCopyOf("Us (2)", "Us")).toBe(true);
    expect(isNumberedCopyOf("Untitled (7)", "")).toBe(true);
    for (const name of ["Us", "Us (1)", "Us (0)", "Us (02)", "Us (x)", "Us(2)", "Us (2) ", "Them (2)", "Us (2) (2)"]) {
      expect(isNumberedCopyOf(name, "Us"), name).toBe(false);
    }
    expect(isNumberedCopyOf("Us (2) (2)", "Us (2)")).toBe(true);
  });
});

// Every run decodes and re-encodes a dozen menus (pako), so give these room when the
// whole suite runs in parallel.
describe("HO-5: importing never overwrites", { timeout: 30_000 }, () => {
  const params = { numRuns: 150 };

  it("only ever adds new menus, and never changes the existing ones", () => {
    fc.assert(
      fc.property(fc.array(docArb, { maxLength: 6 }), fc.array(incomingArb, { maxLength: 8 }), (existing, incoming) => {
        const before = structuredClone(existing);
        const added = planImport(existing, incoming);
        expect(existing).toEqual(before);
        // No ids: storage gives each a fresh one, so nothing can be replaced.
        for (const doc of added) expect(doc.id).toBeUndefined();
      }),
      params
    );
  });

  it("gives every added menu a title no other menu has", () => {
    fc.assert(
      fc.property(fc.array(docArb, { maxLength: 6 }), fc.array(incomingArb, { maxLength: 8 }), (existing, incoming) => {
        const added = planImport(existing, incoming);
        const titles = existing.map((d) => d.title);
        for (const doc of added) {
          expect(titles).not.toContain(doc.title);
          titles.push(doc.title);
        }
      }),
      params
    );
  });

  it("loses nothing: every readable incoming menu is there afterwards", () => {
    fc.assert(
      fc.property(fc.array(docArb, { maxLength: 6 }), fc.array(incomingArb, { maxLength: 8 }), (existing, incoming) => {
        const after = [...existing, ...planImport(existing, incoming)].map(contentOf);
        for (const menu of incoming) {
          const content = contentOf(menu);
          if (content !== null) expect(after).toContain(content);
        }
      }),
      params
    );
  });

  it("never saves junk: every added menu opens like a link would", () => {
    fc.assert(
      fc.property(fc.array(docArb, { maxLength: 4 }), fc.array(incomingArb, { maxLength: 8 }), (existing, incoming) => {
        for (const doc of planImport(existing, incoming)) expect(contentOf(doc)).not.toBeNull();
      }),
      params
    );
  });

  it("adds nothing the second time (a hand-off repeated after a lost reply)", () => {
    fc.assert(
      fc.property(fc.array(docArb, { maxLength: 6 }), fc.array(incomingArb, { maxLength: 8 }), (existing, incoming) => {
        const once = [...existing, ...planImport(existing, incoming)];
        expect(planImport(once, incoming)).toEqual([]);
      }),
      params
    );
  });

  it("skips a menu identical to one already here, and copies one whose title is taken", () => {
    const walks = encodeData({ G: [{ item: "Walks" }] });
    const answered = encodeData({ G: [{ item: "Walks", value: "must-have" }] });
    const existing = [{ id: "a", title: "Us", encoded: walks }];
    expect(planImport(existing, [{ title: "Us", encoded: walks }])).toEqual([]);
    expect(planImport(existing, [{ title: "Us", encoded: answered, createdAt: 1, updatedAt: 2 }])).toEqual([
      { title: "Us (2)", encoded: answered, createdAt: 1, updatedAt: 2 },
    ]);
    // Same items but a different person isn't identical.
    expect(planImport(existing, [{ title: "Us", encoded: walks, person: { name: "Sam" } }])).toEqual([
      { title: "Us (2)", encoded: walks, person: { name: "Sam" } },
    ]);
  });
});
