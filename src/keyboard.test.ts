import { resolveKey } from "./keyboard";

const row = (key: string, extra = {}, pending: string | null = null) =>
  resolveKey({ key, ...extra }, "row", pending);
const input = (key: string, extra = {}) => resolveKey({ key, ...extra }, "input");

describe("resolveKey", () => {
  it("maps vim and arrow keys to the same movement", () => {
    expect(row("j").action).toEqual({ type: "next" });
    expect(row("ArrowDown").action).toEqual({ type: "next" });
    expect(row("k").action).toEqual({ type: "prev" });
    expect(row("ArrowUp").action).toEqual({ type: "prev" });
    expect(row("G").action).toEqual({ type: "last" });
    expect(row("End").action).toEqual({ type: "last" });
  });

  it("maps number keys to preferences", () => {
    expect(row("1").action).toEqual({ type: "set-preference", value: "must-have" });
    expect(row("4").action).toEqual({ type: "set-preference", value: "off-limits" });
    expect(row("0").action).toEqual({ type: "set-preference", value: undefined });
  });

  it("supports two-key sequences gg and dd", () => {
    const g = row("g");
    expect(g.action).toBeNull();
    expect(g.pending).toBe("g");
    expect(row("g", {}, "g").action).toEqual({ type: "first" });
    expect(row("d", {}, "d").action).toEqual({ type: "delete" });
    // A different second key doesn't complete the sequence.
    expect(row("j", {}, "d").action).toEqual({ type: "next" });
  });

  it("maps undo and redo", () => {
    expect(row("u").action).toEqual({ type: "undo" });
    expect(row("z", { ctrlKey: true }).action).toEqual({ type: "undo" });
    expect(row("z", { ctrlKey: true, shiftKey: true }).action).toEqual({ type: "redo" });
    expect(row("y", { metaKey: true }).action).toEqual({ type: "redo" });
    // Ctrl+R stays the browser's reload.
    expect(row("r", { ctrlKey: true }).action).toBeNull();
  });

  it("leaves letters alone while typing", () => {
    for (const key of ["j", "k", "1", "d", "u", "?", "x"]) {
      expect(input(key).action).toBeNull();
    }
    expect(input("Escape").action).toEqual({ type: "stop-editing" });
    expect(input("Enter").action).toEqual({ type: "next-row-input" });
    expect(input("ArrowUp").action).toEqual({ type: "prev-row-input" });
  });

  it("ignores keys with Alt so browser/OS shortcuts keep working", () => {
    expect(row("j", { altKey: true }).action).toBeNull();
  });
});
