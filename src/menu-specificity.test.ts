import { describe, expect, it } from "vitest";
import { SPECIFICITY_HINT, isVagueItem } from "./menu-specificity";

describe("SV-17: underspecified items", () => {
  it.each(["Trust", "quality time", "  Respect  ", "Communication", "Sex"])("%s is vague", (item) => {
    expect(isVagueItem(item)).toBe(true);
  });

  it.each([
    "Trust with money",
    "Weekly quality time, phones away",
    "Sex with each other",
    "Respect for my time when I'm working",
    "Weekly time together",
    "",
  ])("%j is specific enough", (item) => {
    expect(isVagueItem(item)).toBe(false);
  });

  it("gives one plain hint", () => {
    expect(SPECIFICITY_HINT).toMatch(/different things/);
  });
});
