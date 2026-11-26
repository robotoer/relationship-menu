/**
 * Property tests for links (spec §6), keyboard bindings (§4), storage (§5) and the
 * library (§5). Each `it` names the rule it checks.
 */
import fc from "fast-check";
import { decodeCompareSlug, encodeMenuSlug, expandCompareEntry, sanitizePerson } from "../compare-slug";
import { decodeData, encodeData } from "../data-encoder";
import { resolveKey, KeyInput } from "../keyboard";
import { latestByTitle, LocalMenuEntry } from "../storage";
import { matchesSearch, sortMenus } from "../library-info";
import { RelationshipMenu } from "../model/menu";
import { answerArb, menuArb, textArb } from "./arbitraries";

/** What decoding should give back for a menu: items need text, answers are known values. */
const cleaned = (menu: RelationshipMenu): RelationshipMenu => {
  const out: RelationshipMenu = Object.create(null);
  for (const [group, items] of Object.entries(menu)) {
    Object.defineProperty(out, group, {
      value: items.map((i) => {
        const note = (i.note ?? "").trim().slice(0, 280).trimEnd();
        return note ? { item: i.item, value: i.value, note } : { item: i.item, value: i.value };
      }),
      enumerable: true, writable: true, configurable: true,
    });
  }
  return out;
};

const personArb = fc.record(
  { name: fc.string({ maxLength: 80 }), pronouns: fc.string({ maxLength: 40 }), note: fc.string({ maxLength: 300 }) },
  { requiredKeys: [] }
);

describe("link properties", () => {
  it("LK-1/LK-9: encode then decode gives back title, menu (notes trimmed, capped) and cleaned person", () => {
    fc.assert(
      fc.property(textArb, menuArb, fc.option(personArb, { nil: undefined }), (title, menu, person) => {
        const decoded = decodeCompareSlug(encodeMenuSlug(title, menu, person));
        expect(decoded).not.toBeNull();
        expect(decoded!.title).toBe(title);
        expect(Object.keys(decoded!.menu)).toEqual(Object.keys(menu));
        expect(decoded!.menu).toEqual(cleaned(menu));
        expect(decoded!.person).toEqual(sanitizePerson(person));
      })
    );
  });

  it("LK-1/LK-3: cleaning is stable: re-encoding what a link decodes to and decoding again changes nothing", () => {
    // Long text with spaces around where it's cut (280 for notes, 60 for names).
    const nearCut = (cut: number) =>
      fc
        .tuple(fc.integer({ min: cut - 4, max: cut + 2 }), fc.stringMatching(/^[ \n]{1,4}$/), fc.string({ minLength: 1, maxLength: 3 }))
        .map(([n, spaces, rest]) => `${"x".repeat(n)}${spaces}${rest}`);
    const menuNearCut = fc.array(fc.record({ item: textArb, note: fc.oneof(nearCut(280), fc.string()) }), { minLength: 1, maxLength: 3 })
      .map((items): RelationshipMenu => Object.assign(Object.create(null), { G: items }));
    const personNearCut = fc.record({ name: fc.oneof(nearCut(60), fc.string()), note: nearCut(280) }, { requiredKeys: [] });
    fc.assert(
      fc.property(textArb, fc.oneof(menuArb, menuNearCut), fc.option(fc.oneof(personArb, personNearCut), { nil: undefined }), (title, menu, person) => {
        const once = decodeCompareSlug(encodeMenuSlug(title, menu, person))!;
        const twice = decodeCompareSlug(encodeMenuSlug(once.title, once.menu, once.person));
        expect(twice).toEqual(once);
      })
    );
  });

  it("LK-2: a two-part slug (no person) decodes without a person", () => {
    fc.assert(
      fc.property(textArb, menuArb, (title, menu) => {
        const decoded = decodeCompareSlug(`${encodeData(title)}:${encodeData(menu)}`);
        expect(decoded?.title).toBe(title);
        expect(decoded?.person).toBeUndefined();
      })
    );
  });

  it("LK-3: decoding arbitrary text or arbitrary JSON never throws, and output is clean", () => {
    const junkJson = fc.jsonValue();
    fc.assert(
      fc.property(
        fc.oneof(
          fc.string(),
          fc.tuple(junkJson, junkJson, fc.option(junkJson)).map(([a, b, c]) =>
            [a, b, ...(c === null ? [] : [c])].map((v) => encodeData(v)).join(":")
          )
        ),
        (raw) => {
          const decoded = decodeCompareSlug(raw);
          if (decoded === null) return;
          expect(typeof decoded.title).toBe("string");
          for (const items of Object.values(decoded.menu)) {
            for (const item of items) {
              expect(typeof item.item).toBe("string");
              expect([undefined, "must-have", "like-to-have", "maybe", "off-limits"]).toContain(item.value);
            }
          }
          if (decoded.person) {
            const { name = "", pronouns = "", note = "" } = decoded.person;
            expect(name.length).toBeLessThanOrEqual(60);
            expect(pronouns.length).toBeLessThanOrEqual(30);
            expect(note.length).toBeLessThanOrEqual(280);
          }
        }
      )
    );
  });

  it("LK-4: full links, '+'-as-space, fragments and multi-menu compare links all decode", () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(textArb, menuArb), { minLength: 1, maxLength: 3 }), (menus) => {
        const slugs = menus.map(([t, m]) => encodeMenuSlug(t, m));
        // Single link, with an unencoded query (so "+" may arrive as " ") and a fragment.
        const link = `https://relationship-menu.vercel.app/menu?encoded=${slugs[0]}#top`;
        expect(decodeCompareSlug(link)?.title).toBe(menus[0][0]);
        expect(decodeCompareSlug(` ${slugs[0]}\n`)?.title).toBe(menus[0][0]);
        expect(decodeCompareSlug(slugs[0].replace(/\+/g, " "))?.title).toBe(menus[0][0]);
        // Compare link holding every menu: one entry per menu, in order.
        const compare = `https://x/compare?${slugs.map((s) => `encoded=${encodeURIComponent(s)}`).join("&")}`;
        const entries = expandCompareEntry(compare);
        if (slugs.length > 1) {
          expect(entries.map((e) => decodeCompareSlug(e)?.title)).toEqual(menus.map(([t]) => t));
        }
      })
    );
  });

  it("LK-5: a template slug (menu without answers, no person) has neither", () => {
    fc.assert(
      fc.property(textArb, menuArb, (title, menu) => {
        const template: RelationshipMenu = Object.create(null);
        for (const [g, items] of Object.entries(menu))
          Object.defineProperty(template, g, { value: items.map((i) => ({ item: i.item })), enumerable: true });
        const slug = encodeMenuSlug(title, template);
        expect(slug.split(":")).toHaveLength(2);
        const decoded = decodeCompareSlug(slug)!;
        for (const items of Object.values(decoded.menu)) for (const i of items) expect(i.value).toBeUndefined();
      })
    );
  });
});

const keyArb = fc.oneof(
  fc.constantFrom("Escape", "Enter", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "Delete", "Tab", "Backspace", " "),
  fc.string({ minLength: 1, maxLength: 1 })
);
const inputArb: fc.Arbitrary<KeyInput> = fc.record({
  key: keyArb,
  ctrlKey: fc.boolean(),
  metaKey: fc.boolean(),
  altKey: fc.boolean(),
  shiftKey: fc.boolean(),
});
const pendingArb = fc.constantFrom(null, "g", "d");

describe("keyboard properties", () => {
  it("KB-1: in typing mode only Esc, Enter, ↑ and ↓ are intercepted", () => {
    fc.assert(
      fc.property(inputArb, pendingArb, (e, pending) => {
        const { action } = resolveKey(e, "input", pending);
        const intercepted = !e.altKey && !e.ctrlKey && !e.metaKey && ["Escape", "Enter", "ArrowUp", "ArrowDown"].includes(e.key);
        expect(action !== null).toBe(intercepted);
      })
    );
  });

  it("KB-2: Alt is never intercepted; Ctrl/⌘ only for Z and Y", () => {
    fc.assert(
      fc.property(inputArb, fc.constantFrom("row" as const, "input" as const), pendingArb, (e, mode, pending) => {
        const { action } = resolveKey(e, mode, pending);
        if (e.altKey) expect(action).toBeNull();
        if ((e.ctrlKey || e.metaKey) && action) {
          expect(["z", "y"]).toContain(e.key.toLowerCase());
          expect(["undo", "redo"]).toContain(action.type);
        }
      })
    );
  });

  it("KB-3: gg/dd need both keys in a row; any other key in between cancels", () => {
    const plain = (key: string): KeyInput => ({ key });
    fc.assert(
      fc.property(fc.constantFrom("g", "d"), keyArb, (first, between) => {
        const step1 = resolveKey(plain(first), "row", null);
        expect(step1).toEqual({ action: null, pending: first });
        const direct = resolveKey(plain(first), "row", step1.pending).action;
        expect(direct?.type).toBe(first === "g" ? "first" : "delete");
        // A different key in between behaves exactly as if nothing were pending.
        if (between !== first) {
          expect(resolveKey(plain(between), "row", step1.pending)).toEqual(resolveKey(plain(between), "row", null));
        }
      })
    );
  });

  it("KB-5: arrow keys and vim keys do the same thing", () => {
    const pairs: [string, string][] = [["ArrowDown", "j"], ["ArrowUp", "k"], ["ArrowLeft", "h"], ["ArrowRight", "l"]];
    fc.assert(
      fc.property(fc.constantFrom(...pairs), pendingArb, ([arrow, vim], pending) => {
        expect(resolveKey({ key: arrow }, "row", pending)).toEqual(resolveKey({ key: vim }, "row", pending));
      })
    );
  });
});

describe("storage and library properties", () => {
  const entryArb: fc.Arbitrary<LocalMenuEntry> = fc.record({
    key: fc.string(),
    doc: fc.record({ title: textArb, encoded: fc.string() }),
    savedAt: fc.nat({ max: 50 }),
  });

  it("SV-6: one entry per title, and it is a most recently saved one", () => {
    fc.assert(
      fc.property(fc.array(entryArb, { maxLength: 12 }), (entries) => {
        const best = latestByTitle(entries);
        const titles = new Set(entries.map((e) => e.doc.title));
        expect(new Set(Object.keys(best))).toEqual(titles);
        for (const title of Array.from(titles)) {
          const newest = Math.max(...entries.filter((e) => e.doc.title === title).map((e) => e.savedAt));
          expect(best[title].savedAt).toBe(newest);
          expect(best[title].doc.title).toBe(title);
        }
      })
    );
  });

  const docArb = fc.record(
    {
      title: textArb,
      encoded: menuArb.map((m) => encodeData(m)),
      createdAt: fc.nat({ max: 1000 }),
      updatedAt: fc.nat({ max: 1000 }),
      person: fc.record({ name: textArb }),
    },
    { requiredKeys: ["title", "encoded"] }
  );

  it("LB-2: search matches title, person, group, item or note text, ignoring case — and nothing else", () => {
    fc.assert(
      fc.property(docArb, textArb, (doc, query) => {
        const q = query.trim().toLowerCase();
        const decoded = decodeData(doc.encoded) as RelationshipMenu;
        const texts = [doc.title, doc.person?.name ?? ""]
          .concat(Object.keys(decoded))
          .concat(Object.values(decoded).flat().map((i) => i.item))
          .concat(Object.values(decoded).flat().map((i) => i.note ?? ""));
        // (Title and person are searched as one string, so a query may span them.)
        const expected = !q || texts.some((t) => t.toLowerCase().includes(q)) ||
          [doc.title, doc.person?.name].filter(Boolean).join(" ").toLowerCase().includes(q);
        expect(matchesSearch(doc, query)).toBe(expected);
      })
    );
  });

  it("LB-2: sorting is a permutation; date sorts are newest first with undated last", () => {
    fc.assert(
      fc.property(fc.array(docArb, { maxLength: 8 }), fc.constantFrom("edited" as const, "created" as const, "title" as const), (docs, sort) => {
        const sorted = sortMenus(docs, sort);
        expect(sorted).toHaveLength(docs.length);
        expect(new Set(sorted)).toEqual(new Set(docs));
        if (sort !== "title") {
          const key = sort === "created" ? "createdAt" : "updatedAt";
          for (let i = 1; i < sorted.length; i++) {
            expect(sorted[i - 1][key] ?? 0).toBeGreaterThanOrEqual(sorted[i][key] ?? 0);
          }
        }
      })
    );
  });
});
