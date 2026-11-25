import { encodeData } from "./data-encoder";
import { matchesSearch, menuStats, relativeTime, sortMenus } from "./library-info";

const encoded = encodeData({
  A: [{ item: "Kissing", value: "maybe" }, { item: "Hugging" }, { item: "  " }],
  B: [{ item: "Trust", value: "must-have" }],
});

describe("library info", () => {
  it("counts groups, items and answers (ignoring blank items)", () => {
    expect(menuStats(encoded)).toEqual({ groups: 2, items: 3, answered: 2 });
    expect(menuStats("garbage")).toEqual({ groups: 0, items: 0, answered: 0 });
  });

  it("formats relative times", () => {
    const now = Date.UTC(2026, 0, 10);
    expect(relativeTime(now - 10 * 1000, now)).toBe("just now");
    expect(relativeTime(now - 3 * 24 * 3600 * 1000, now)).toMatch(/3 days ago/);
  });

  it("sorts by edited, created and title; undated menus last", () => {
    const menus = [
      { title: "b", encoded, updatedAt: 1, createdAt: 3 },
      { title: "A", encoded },
      { title: "c", encoded, updatedAt: 2, createdAt: 1 },
    ];
    expect(sortMenus(menus, "edited").map((m) => m.title)).toEqual(["c", "b", "A"]);
    expect(sortMenus(menus, "created").map((m) => m.title)).toEqual(["b", "c", "A"]);
    expect(sortMenus(menus, "title").map((m) => m.title)).toEqual(["A", "b", "c"]);
  });

  it("searches titles, people and item text", () => {
    const menu = { title: "Us", encoded, person: { name: "Sam", pronouns: "they/them" } };
    expect(matchesSearch(menu, "sam")).toBe(true);
    expect(matchesSearch(menu, "TRUST")).toBe(true);
    expect(matchesSearch(menu, "dancing")).toBe(false);
    expect(matchesSearch(menu, "  ")).toBe(true);
  });
});
