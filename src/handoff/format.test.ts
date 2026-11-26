import fc from "fast-check";
import {
  HandoffMenu,
  encodeHandoffReply,
  encodeHandoffRequest,
  parseHandoffReply,
  parseHandoffRequest,
} from "./format";

/**
 * The hand-off's wire format (spec HO-4, HO-5). On the new address the request is
 * untrusted input: anyone can link to /import#…. Parsing must never throw, and must
 * never let through anything but well-formed menus.
 */

const ID = "AAAAAAAAAAAAAAAAAAAAAA";
const menu = (title: string, extra: Partial<HandoffMenu> = {}): HandoffMenu => ({ title, encoded: "eJyrVkrOT0lVslJKzEvMTVWqBQApRQUN", ...extra });

const menuArb: fc.Arbitrary<HandoffMenu> = fc.record(
  {
    title: fc.string({ maxLength: 30 }),
    encoded: fc.base64String({ minLength: 4, maxLength: 60 }),
    person: fc.record({ name: fc.string({ maxLength: 10 }), pronouns: fc.string({ maxLength: 5 }) }, { requiredKeys: [] }),
    createdAt: fc.integer({ min: 0, max: 2e12 }),
    updatedAt: fc.integer({ min: 0, max: 2e12 }),
  },
  { requiredKeys: ["title", "encoded"] }
).filter((m) => m.encoded.length > 0)
  // Person info with no fields travels as no person.
  .map((m) => (m.person && Object.keys(m.person).length === 0 ? (({ person: _, ...rest }) => rest)(m) : m));

/** Every menu the parser returns is well-formed. */
const wellFormed = (m: HandoffMenu) =>
  typeof m.title === "string" &&
  /^[A-Za-z0-9+/]+={0,2}$/.test(m.encoded) &&
  Object.keys(m).every((k) => ["title", "encoded", "person", "createdAt", "updatedAt"].includes(k)) &&
  (m.person === undefined || Object.values(m.person).every((v) => typeof v === "string")) &&
  [m.createdAt, m.updatedAt].every((t) => t === undefined || Number.isFinite(t));

describe("HO-4: hand-off requests", () => {
  it("round-trips any menus", () => {
    fc.assert(
      fc.property(fc.array(menuArb, { maxLength: 8 }), (menus) => {
        expect(parseHandoffRequest(encodeHandoffRequest({ id: ID, menus }))).toEqual({ id: ID, menus, complete: true });
      })
    );
  });

  it("accepts the fragment with or without its #", () => {
    const fragment = encodeHandoffRequest({ id: ID, menus: [menu("A")] });
    expect(parseHandoffRequest(`#${fragment}`)).toEqual(parseHandoffRequest(fragment));
  });

  it("puts the menus last, so a URL cut short still names the request", () => {
    const fragment = encodeHandoffRequest({ id: ID, menus: [menu("A"), menu("B")] });
    expect(fragment.indexOf("menus=")).toBeGreaterThan(fragment.indexOf("id="));
    expect(parseHandoffRequest(fragment.slice(0, -10))).toEqual({ id: ID, menus: [], complete: false });
  });
});

describe("HO-5: the importer's input is untrusted", () => {
  it("never throws on arbitrary text, and returns only well-formed menus", () => {
    fc.assert(
      fc.property(fc.oneof(fc.string(), fc.string({ unit: "binary" }), fc.webFragments()), (junk) => {
        const parsed = parseHandoffRequest(junk);
        if (parsed) parsed.menus.forEach((m) => expect(wellFormed(m)).toBe(true));
        parseHandoffReply(junk);
      })
    );
  });

  it("never throws on a real request with any part cut off or changed, and never claims a damaged one is complete", () => {
    fc.assert(
      fc.property(
        fc.array(menuArb, { minLength: 1, maxLength: 5 }),
        fc.nat(),
        fc.nat(),
        fc.string({ maxLength: 3 }),
        (menus, cut, at, insert) => {
          const fragment = encodeHandoffRequest({ id: ID, menus });
          const truncated = fragment.slice(0, cut % fragment.length);
          const changed = fragment.slice(0, at % fragment.length) + insert + fragment.slice(at % fragment.length);
          for (const damaged of [truncated, changed]) {
            const parsed = parseHandoffRequest(damaged);
            if (!parsed) continue;
            parsed.menus.forEach((m) => expect(wellFormed(m)).toBe(true));
            // Complete means the list arrived whole; menus in it that are malformed are
            // still dropped (an unreadable old entry mustn't block the rest, every visit).
            if (parsed.complete) expect(parsed.menus.length).toBeLessThanOrEqual(Number(new URLSearchParams(damaged).get("count")));
          }
          expect(parseHandoffRequest(truncated)?.complete ?? false).toBe(truncated === fragment);
        }
      )
    );
  });

  it.each([
    ["no hand-off marker", `id=${ID}&count=0&menus=[]`],
    ["another version", `handoff=2&id=${ID}&count=0&menus=[]`],
    ["no id", "handoff=1&count=0&menus=[]"],
    ["a malformed id", "handoff=1&id=short&count=0&menus=[]"],
    ["an id with odd characters", `handoff=1&id=${"A".repeat(21)}%2F&count=0&menus=[]`],
    ["nothing", ""],
    ["null", null],
  ])("isn't a request with %s", (_, fragment) => {
    expect(parseHandoffRequest(fragment)).toBeNull();
  });

  it.each([
    ["menus that aren't JSON", "{not json"],
    ["menus that aren't a list", JSON.stringify({ title: "A", encoded: "abcd" })],
    ["too many menus", JSON.stringify(Array(2001).fill(menu("A")))],
  ])("reads %s as incomplete, with no menus", (_, menus) => {
    const fragment = new URLSearchParams({ handoff: "1", id: ID, count: "1", menus }).toString();
    expect(parseHandoffRequest(fragment)).toEqual({ id: ID, menus: [], complete: false });
  });

  it("is incomplete when the count doesn't match", () => {
    for (const count of ["3", "", "1.0", "-2", "01"]) {
      const fragment = new URLSearchParams({ handoff: "1", id: ID, count, menus: JSON.stringify([menu("A")]) }).toString();
      expect(parseHandoffRequest(fragment)?.complete, count).toBe(false);
    }
  });

  it("drops malformed menus and fields, keeping the rest", () => {
    const menus = [
      menu("Kept", { person: { name: "Sam" }, createdAt: 5, updatedAt: 6 }),
      { title: 7, encoded: "abcd" },
      { title: "No menu" },
      { title: "Not base64", encoded: "<script>" },
      { title: "Empty", encoded: "" },
      null,
      "text",
      [menu("Nested")],
      { title: "Long", encoded: "abcd".repeat(600_000) },
      { title: "x".repeat(10_001), encoded: "abcd" },
      {
        title: "Odd fields",
        encoded: "abcd",
        person: { name: 3, pronouns: "they/them", note: { a: 1 }, extra: "x" },
        createdAt: "yesterday",
        updatedAt: Infinity,
        id: "AAAAAAAAAAAAAAAAAAAAAA",
        __proto__: { polluted: true },
      },
      { title: "No person left", encoded: "abcd", person: { name: 1 } },
    ];
    const fragment = new URLSearchParams({ handoff: "1", id: ID, count: String(menus.length), menus: JSON.stringify(menus) }).toString();
    expect(parseHandoffRequest(fragment)).toEqual({
      id: ID,
      complete: true,
      menus: [
        menu("Kept", { person: { name: "Sam" }, createdAt: 5, updatedAt: 6 }),
        { title: "Odd fields", encoded: "abcd", person: { pronouns: "they/them" } },
        { title: "No person left", encoded: "abcd" },
      ],
    });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("refuses an absurdly long fragment without reading it", () => {
    expect(parseHandoffRequest(`handoff=1&id=${ID}&count=0&menus=[]&pad=${"x".repeat(5 * 1024 * 1024)}`)).toBeNull();
  });
});

describe("HO-4: replies", () => {
  it("round-trip", () => {
    expect(parseHandoffReply(encodeHandoffReply({ id: ID, ok: true }))).toEqual({ id: ID, ok: true });
    expect(parseHandoffReply(`#${encodeHandoffReply({ id: ID, ok: false })}`)).toEqual({ id: ID, ok: false });
  });

  it.each(["", "handoff-reply=x&ok=1", `handoff-reply=${ID}`, `handoff-reply=${ID}&ok=yes`, "top", `ok=1`])(
    "ignores %j",
    (fragment) => expect(parseHandoffReply(fragment)).toBeNull()
  );
});
