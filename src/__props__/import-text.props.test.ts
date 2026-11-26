/**
 * Property tests for Import menus in the Library (spec SV-14): reading menu links
 * out of pasted text or the file Export all menus makes (SV-13), and adding them
 * without overwriting anything (HO-5's rules, LK-6's naming). They run the REAL
 * exportText, menuEntries, planTextImport and importSummary.
 */
import fc from "fast-check";
import { decodeCompareSlug, encodeMenuSlug } from "../compare-slug";
import { encodeData } from "../data-encoder";
import { exportText, menuLink } from "../export-menus";
import { importSummary, menuEntries, planTextImport } from "../import-menus";
import { isNumberedCopyOf } from "../menu-titles";
import { RelationshipMenuDocument } from "../model/menu";
import { menuArb } from "./arbitraries";

const NOW = Date.UTC(2026, 10, 26, 12);

/** Titles that collide often, including numbered copies and awkward names. */
const titleArb = fc.constantFrom("Us", "Us (2)", "Them", "", "Untitled (2)", "__proto__", "a (b)", "Ana's menu: v2", "x (1)");
const personArb = fc.option(
  fc.record({ name: fc.constantFrom("Sam", "Ari", " Bo "), pronouns: fc.constantFrom("they/them", "she/her"), note: fc.string({ maxLength: 6 }) }, { requiredKeys: [] }),
  { nil: undefined }
);
/** A small pool of menus, so identical contents come up often. */
const encodedArb = fc.oneof(
  fc.constantFrom(encodeData({ G: [{ item: "Walks" }] }), encodeData({ G: [{ item: "Walks", value: "must-have" }] })),
  menuArb.map((menu) => encodeData(menu))
);
const docArb: fc.Arbitrary<RelationshipMenuDocument> = fc
  .record({ title: titleArb, encoded: encodedArb, person: personArb })
  .map(({ person, ...doc }) => (person ? { ...doc, person } : doc));
const libraryArb = fc.array(docArb, { maxLength: 6 });

/** Where a backup or a pasted link may come from: this address, the old one, a test server. */
const originArb = fc.constantFrom("https://wantsandwonts.com", "https://relationship-menu.vercel.app", "http://localhost:3099");

/** Prose around a pasted link: never itself a link or a slug. */
const wordArb = fc
  .oneof(fc.constantFrom("Here's", "my", "menu:", "10:30,", "Re:Hi", "(see", "below).", "—", "1.", "Won'ts:"), fc.string({ maxLength: 8 }))
  .filter((word) => !word.includes("encoded=") && !/\s/.test(word) && word !== "");
const separatorArb = fc.constantFrom(" ", "\n", "\n\n", "  \t");

/** What a menu is, for "is it still there?": its decoded content and person (not title or dates). */
const contentOf = (m: { title: string; encoded: string; person?: unknown }) => {
  const decoded = decodeCompareSlug(encodeMenuSlug(m.title, m.encoded, m.person as never));
  return decoded ? JSON.stringify([decoded.menu, decoded.person ?? null]) : null;
};

// Every run encodes and decodes a dozen menus (pako), so give these room when the
// whole suite runs in parallel.
describe("SV-14: Import menus reads menu links from text", { timeout: 30_000 }, () => {
  const params = { numRuns: 120 };

  it("a backup file brings back every menu in it, into an empty Library, from any address", () => {
    fc.assert(
      fc.property(libraryArb, originArb, (docs, origin) => {
        const result = planTextImport([], exportText(docs, origin, NOW), NOW);
        expect(result.found).toBe(docs.length);
        expect(result.unreadable).toBe(0);
        expect(result.add.length + result.alreadyHere).toBe(result.found);
        const added = result.add.map(contentOf);
        for (const doc of docs) expect(added).toContain(contentOf(doc));
        // Added like a link opened and saved for the first time (SV-8).
        for (const doc of result.add) {
          expect(doc.createdAt).toBe(NOW);
          expect(doc.updatedAt).toBe(NOW);
        }
      }),
      params
    );
  });

  it("importing a Library's own backup into it adds nothing", () => {
    fc.assert(
      fc.property(libraryArb, originArb, (docs, origin) => {
        const result = planTextImport(docs, exportText(docs, origin, NOW), NOW);
        expect(result.add).toEqual([]);
        expect(result.alreadyHere).toBe(docs.length);
      }),
      params
    );
  });

  it("never overwrites: only new menus, each with a title no other menu has", () => {
    fc.assert(
      fc.property(libraryArb, libraryArb, originArb, (existing, backedUp, origin) => {
        const before = structuredClone(existing);
        const result = planTextImport(existing, exportText(backedUp, origin, NOW), NOW);
        expect(existing).toEqual(before);
        const titles = existing.map((d) => d.title);
        for (const doc of result.add) {
          // No id: storage gives each a fresh one, so nothing can be replaced.
          expect(doc.id).toBeUndefined();
          expect(titles).not.toContain(doc.title);
          titles.push(doc.title);
        }
        // A copy is named the LK-6 way, "Title (n)", and is one of the added menus.
        const addedTitles = result.add.map((d) => d.title);
        for (const { from, to } of result.renamed) {
          expect(isNumberedCopyOf(to, from)).toBe(true);
          expect(addedTitles).toContain(to);
        }
      }),
      params
    );
  });

  it("loses nothing, and doing it twice adds nothing the second time", () => {
    fc.assert(
      fc.property(libraryArb, libraryArb, originArb, (existing, backedUp, origin) => {
        const text = exportText(backedUp, origin, NOW);
        const once = [...existing, ...planTextImport(existing, text, NOW).add];
        const after = once.map(contentOf);
        for (const doc of backedUp) expect(after).toContain(contentOf(doc));
        expect(planTextImport(once, text, NOW).add).toEqual([]);
      }),
      params
    );
  });

  it("finds each link in pasted prose, whatever punctuation is stuck to it; words alone are never links", () => {
    const wraps = [
      (link: string) => link,
      (link: string) => `(${link}).`,
      (link: string) => `<${link}>`,
      (link: string) => `"${link}",`,
      (link: string) => `${link}!`,
    ];
    // Markdown, for links only: a bare slug is pasted on its own.
    const linkWraps = [...wraps, (link: string) => `[menu](${link})`];
    const pieceArb = fc.oneof(
      { weight: 3, arbitrary: wordArb.map((word) => ({ word })) },
      {
        weight: 1,
        arbitrary: fc
          .tuple(docArb, originArb, fc.boolean(), fc.nat())
          .map(([doc, origin, bare, w]) => ({ doc, origin, bare, wrap: bare ? wraps[w % wraps.length] : linkWraps[w % linkWraps.length] })),
      }
    );
    fc.assert(
      fc.property(fc.array(fc.tuple(pieceArb, separatorArb), { maxLength: 12 }), (pieces) => {
        const docs: RelationshipMenuDocument[] = [];
        const text = pieces
          .map(([piece, sep]) => {
            if ("word" in piece) return piece.word + sep;
            docs.push(piece.doc);
            const link = piece.bare
              ? encodeMenuSlug(piece.doc.title, piece.doc.encoded, piece.doc.person)
              : menuLink(piece.origin, piece.doc);
            return piece.wrap(link) + sep;
          })
          .join("");
        expect(menuEntries(text)).toHaveLength(docs.length);
        const result = planTextImport([], text, NOW);
        expect(result.found).toBe(docs.length);
        expect(result.unreadable).toBe(0);
        const added = result.add.map(contentOf);
        for (const doc of docs) expect(added).toContain(contentOf(doc));
      }),
      params
    );
  });

  it("a compare link holding several menus brings each of them", () => {
    fc.assert(
      fc.property(fc.array(docArb, { minLength: 2, maxLength: 4 }), originArb, (docs, origin) => {
        const query = docs.map((d) => `encoded=${encodeURIComponent(encodeMenuSlug(d.title, d.encoded, d.person))}`).join("&");
        const result = planTextImport([], `${origin}/compare?${query}`, NOW);
        expect(result.found).toBe(docs.length);
        expect(result.add.length + result.alreadyHere).toBe(docs.length);
      }),
      params
    );
  });

  it("a cut-off link is counted, never saved as junk; the rest still come in", () => {
    fc.assert(
      fc.property(libraryArb, originArb, fc.nat(), (docs, origin, at) => {
        const links = docs.map((doc) => menuLink(origin, doc));
        if (links.length === 0) return;
        const i = at % links.length;
        const start = links[i].indexOf("encoded=") + "encoded=".length;
        // Cut somewhere in the slug, as a message app might.
        links[i] = links[i].slice(0, start + (at % (links[i].length - start)));
        const result = planTextImport([], links.join("\n"), NOW);
        expect(result.found + result.unreadable).toBe(links.length);
        // Whatever was read opens like a link would.
        for (const doc of result.add) expect(contentOf(doc)).not.toBeNull();
        // The whole links all came in.
        const added = result.add.map(contentOf);
        docs.forEach((doc, k) => {
          if (k !== i) expect(added).toContain(contentOf(doc));
        });
      }),
      params
    );
  });

  it("never throws on arbitrary text, and finds nothing in text with no links", () => {
    fc.assert(
      fc.property(fc.string({ unit: "binary", maxLength: 200 }), (text) => {
        const result = planTextImport([], text, NOW);
        if (!text.includes("encoded=")) expect(result.found).toBe(0);
        expect(result.add.length + result.alreadyHere).toBe(result.found);
      }),
      { numRuns: 300 }
    );
  });

  it("the summary gives the plan's numbers", () => {
    fc.assert(
      fc.property(libraryArb, libraryArb, originArb, fc.nat(3), (existing, backedUp, origin, cut) => {
        const lines = backedUp.map((doc) => menuLink(origin, doc));
        for (let k = 0; k < cut; k++) lines.push(`${origin}/menu?encoded=AAAA${k}`);
        const result = planTextImport(existing, lines.join("\n"), NOW);
        const summary = importSummary(result);
        if (result.add.length > 0) {
          expect(summary).toMatch(new RegExp(`^Added ${result.add.length} menus?[,.]`));
        } else if (result.found > 0) {
          expect(summary).toMatch(/^Nothing new: /);
        }
        const was = result.alreadyHere === 1 ? "was" : "were";
        if (result.alreadyHere > 0 && result.add.length > 0) {
          expect(summary).toContain(`, ${result.alreadyHere} ${was} already here.`);
        } else if (result.alreadyHere > 0) {
          expect(summary).toContain(`${result.alreadyHere} menu${result.alreadyHere === 1 ? "" : "s"} ${was} already here.`);
        } else {
          expect(summary).not.toContain("already here");
        }
        if (result.found > 0 && result.unreadable > 0) {
          expect(summary).toContain(`${result.unreadable} link${result.unreadable === 1 ? "" : "s"} couldn't be read.`);
        }
      }),
      params
    );
  });
});
