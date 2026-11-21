import { decodeCompareSlug, normalizeCompareEntry } from "./compare-slug";
import { encodeData } from "./data-encoder";

const menu = { Physical: [{ item: "Kissing", value: "must-have" }] };

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
});
