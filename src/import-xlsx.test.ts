import { describe, expect, it } from "vitest";
import { sheetAsTsv, sheetRows, unzip } from "./import-xlsx";
import { readMenuFile } from "./import-formats";

/** A minimal ZIP writer (stored, no compression) so tests need no fixture files. */
const zip = (files: { [name: string]: string }): Uint8Array => {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const u32 = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
  const u16 = (n: number) => [n & 0xff, (n >>> 8) & 0xff];
  for (const [name, content] of Object.entries(files)) {
    const file = encoder.encode(content);
    const nameBytes = encoder.encode(name);
    const local = new Uint8Array([
      ...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(0), ...u32(file.length), ...u32(file.length), ...u16(nameBytes.length), ...u16(0),
      ...nameBytes,
    ]);
    parts.push(local, file);
    central.push(
      new Uint8Array([
        ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
        ...u32(0), ...u32(file.length), ...u32(file.length), ...u16(nameBytes.length), ...u16(0),
        ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...nameBytes,
      ])
    );
    offset += local.length + file.length;
  }
  const directory = central.reduce((n, part) => n + part.length, 0);
  const end = new Uint8Array([
    ...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(Object.keys(files).length), ...u16(Object.keys(files).length),
    ...u32(directory), ...u32(offset), ...u16(0),
  ]);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((n, part) => n + part.length, 0));
  let at = 0;
  for (const part of all) {
    out.set(part, at);
    at += part.length;
  }
  return out;
};

const text = (value: string) => `<t>${value.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</t>`;

/** An xlsx with one sheet, shared strings, and the given rows (each: strings or numbers). */
const workbook = (rows: (string | number)[][]): Uint8Array => {
  const shared: string[] = [];
  const rowXml = rows
    .map((cells, r) => {
      const cellXml = cells
        .map((cell, c) => {
          const ref = `${String.fromCharCode(65 + c)}${r + 1}`;
          if (typeof cell === "number") return `<c r="${ref}"><v>${cell}</v></c>`;
          shared.push(cell);
          return `<c r="${ref}" t="s"><v>${shared.length - 1}</v></c>`;
        })
        .join("");
      return `<row r="${r + 1}">${cellXml}</row>`;
    })
    .join("");
  return zip({
    "[Content_Types].xml": '<?xml version="1.0"?><Types/>',
    "xl/sharedStrings.xml": `<?xml version="1.0"?><sst>${shared.map((s) => `<si>${text(s)}</si>`).join("")}</sst>`,
    "xl/worksheets/sheet1.xml": `<?xml version="1.0"?><worksheet><sheetData>${rowXml}</sheetData></worksheet>`,
  });
};

describe("SV-16: Excel workbooks", () => {
  it("unzips the files it is asked for", () => {
    const files = unzip(zip({ "a.txt": "one", "b/c.txt": "two" }));
    expect(new TextDecoder().decode(files.get("a.txt")!)).toBe("one");
    expect(new TextDecoder().decode(files.get("b/c.txt")!)).toBe("two");
  });

  it("reads a sheet as rows, keeping empty cells in their columns", () => {
    const rows = sheetRows(
      workbook([
        ["Section", "Item", "Selection"],
        ["Time", "Weekly time together", "■"],
        ["Time", "", "♥"],
      ])
    );
    expect(rows).toEqual([
      ["Section", "Item", "Selection"],
      ["Time", "Weekly time together", "■"],
      ["Time", "", "♥"],
    ]);
    expect(sheetAsTsv(workbook([["a", "b"]]))).toBe("a\tb");
  });

  it("reads the web menu's own export: Section, Item, Selection with symbols", () => {
    const file = workbook([
      ["Section", "Item", "Selection"],
      ["Connection & agreements", "Marriage", "■"],
      ["Connection & agreements", "Sharing pet(s)", "♥"],
      ["Emotional intimacy", "Saying I love you", "?"],
      ["Emotional intimacy", "Co-parenting", "✘"],
    ]);
    const read = readMenuFile(sheetAsTsv(file), "relationship-menu.tsv")!;
    expect(read.source).toBe("table");
    expect(read.menus[0].menu).toEqual({
      "Connection & agreements": [
        { item: "Marriage", value: "must-have" },
        { item: "Sharing pet(s)", value: "like-to-have" },
      ],
      "Emotional intimacy": [
        { item: "Saying I love you", value: "maybe" },
        { item: "Co-parenting", value: "off-limits" },
      ],
    });
  });

  it("keeps Soft no from a workbook's Selection column", () => {
    const file = workbook([
      ["Section", "Item", "Selection"],
      ["Commitment", "Children", "Soft no"],
      ["Commitment", "Marriage", ""],
    ]);
    const read = readMenuFile(sheetAsTsv(file), "menu.tsv")!;
    expect(read.menus[0].menu.Commitment).toEqual([{ item: "Children", value: "soft-no" }, { item: "Marriage" }]);
  });

  it("explains an unreadable workbook instead of guessing", () => {
    expect(() => unzip(new Uint8Array([1, 2, 3]))).toThrow();
    expect(() => sheetRows(zip({ "xl/worksheets/sheet1.xml": "<worksheet/>" }))).not.toThrow();
  });
});
