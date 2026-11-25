import {
  decodeCompareSlug,
  encodeMenuSlug,
  expandCompareEntry,
  normalizeCompareEntry,
} from "./compare-slug";
import { compareMenus } from "./data-comparer";
import { encodeData } from "./data-encoder";
import { RelationshipMenu } from "./model/menu";

const menu: RelationshipMenu = {
  Physical: [{ item: "Kissing", value: "must-have" }],
};

/** Builds a slug whose base64 contains "+", which breaks unencoded query strings. */
const slugWithPlus = () => {
  for (let i = 0; i < 500; i++) {
    const s = `${encodeData(`Title ${i}`)}:${encodeData(menu)}`;
    if (s.includes("+")) return s;
  }
  throw new Error("could not build a slug containing '+'");
};

describe("compare-slug", () => {
  const slug = `${encodeData("Alice")}:${encodeData(menu)}`;

  it("decodes a plain slug", () => {
    expect(decodeCompareSlug(slug)).toEqual({ title: "Alice", menu });
  });

  it("decodes a slug with surrounding whitespace", () => {
    expect(decodeCompareSlug(`  ${slug}\n`)).toEqual({ title: "Alice", menu });
  });

  it("decodes a share link", () => {
    const link = `https://example.com/menu?encoded=${encodeURIComponent(slug)}`;
    expect(normalizeCompareEntry(link)).toBe(slug);
    expect(decodeCompareSlug(link)).toEqual({ title: "Alice", menu });
  });

  it("decodes a slug whose '+' characters were turned into spaces", () => {
    const plus = slugWithPlus();
    const mangled = plus.replace(/\+/g, " ");
    expect(normalizeCompareEntry(mangled)).toBe(plus);
    expect(decodeCompareSlug(mangled)).not.toBeNull();
  });

  it.each([
    ["empty string", ""],
    ["partial slug", slug.slice(0, 10)],
    ["no colon", encodeData("Alice")],
    ["garbage", "not a slug at all!"],
    ["menu that is not an object", `${encodeData("A")}:${encodeData("nope")}`],
    ["menu groups that are not arrays", `${encodeData("A")}:${encodeData({ g: 1 })}`],
    ["link without a slug", "https://example.com/menu?encoded="],
  ])("returns null for %s", (_, value) => {
    expect(decodeCompareSlug(value)).toBeNull();
  });

  it("drops malformed items and unknown preferences instead of crashing", () => {
    const crafted = `${encodeData("Mallory")}:${encodeData({
      G: [
        { item: 5 },
        null,
        "text",
        { item: "Trust", value: "<script>" },
        { item: "Kissing", value: "maybe" },
      ],
    })}`;
    const decoded = decodeCompareSlug(crafted);
    expect(decoded?.menu).toEqual({
      G: [
        { item: "Trust", value: undefined },
        { item: "Kissing", value: "maybe" },
      ],
    });
    expect(() => compareMenus([decoded!.menu, menu])).not.toThrow();
  });

  it("ignores a #fragment after the slug in a link", () => {
    const link = `https://example.com/menu?encoded=${encodeURIComponent(slug)}#top`;
    expect(decodeCompareSlug(link)).toEqual({ title: "Alice", menu });
  });

  it("expands a compare link holding several menus into one entry per menu", () => {
    const other = `${encodeData("Bob")}:${encodeData(menu)}`;
    const link = `https://example.com/compare?encoded=${encodeURIComponent(
      slug
    )}&encoded=${encodeURIComponent(other)}`;
    expect(expandCompareEntry(link)).toEqual([slug, other]);
    expect(expandCompareEntry(slug)).toEqual([slug]);
    expect(expandCompareEntry("partial")).toEqual(["partial"]);
  });

  it("round-trips person info as an optional third part", () => {
    const withPerson = encodeMenuSlug("Us", menu, {
      name: "  Sam ",
      pronouns: "they/them",
      note: "",
    });
    expect(withPerson.split(":")).toHaveLength(3);
    expect(decodeCompareSlug(withPerson)).toEqual({
      title: "Us",
      menu,
      person: { name: "Sam", pronouns: "they/them" },
    });
    // No person info: two parts, same as older links.
    expect(encodeMenuSlug("Us", menu).split(":")).toHaveLength(2);
    expect(encodeMenuSlug("Us", menu, { name: " " }).split(":")).toHaveLength(2);
  });

  it("ignores unreadable person info but still opens the menu", () => {
    expect(decodeCompareSlug(`${slug}:not-base64!`)).toEqual({ title: "Alice", menu });
  });

  it("caps person field lengths", () => {
    const decoded = decodeCompareSlug(encodeMenuSlug("Us", menu, { name: "x".repeat(500) }));
    expect(decoded?.person?.name).toHaveLength(60);
  });
});
