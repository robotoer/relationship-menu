/**
 * Excel workbooks (spec SV-16): `.xlsx` and `.xlsm`, which is what people get from
 * Google Sheets ("Download → Microsoft Excel") and from the popular web versions of
 * the relationship menu. Read here rather than in the main bundle: this module is
 * only ever imported with `import()` when someone chooses a workbook.
 *
 * An xlsx file is a ZIP of XML. Reading it needs no library beyond the `pako` the app
 * already ships: find the entries in the ZIP's central directory, inflate the two
 * we need, then read the cells. Only the first worksheet is read, which is where
 * these menus live.
 */

import { inflateRaw } from "pako";

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

/** The bytes of each file in a ZIP, by name. Only the entries asked for are inflated. */
export const unzip = (bytes: Uint8Array): Map<string, Uint8Array> => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The end-of-central-directory record sits at the end, after a comment of up to 64 KB.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Not a zip file");
  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const files = new Map<string, Uint8Array>();
  const decoder = new TextDecoder();
  for (let entry = 0; entry < count; entry++) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== SIG_CENTRAL) break;
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    offset += 46 + nameLength + extraLength + commentLength;
    if (localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== SIG_LOCAL) continue;
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const data = bytes.subarray(start, start + compressedSize);
    try {
      files.set(name, method === 0 ? data : inflateRaw(data));
    } catch {
      // An entry we can't read isn't needed: skip it and keep going.
    }
  }
  return files;
};

/** Text of the `t` elements under `node`, in document order. */
const textOf = (node: Element | null): string =>
  !node
    ? ""
    : [...node.querySelectorAll("t")]
        .map((t) => t.textContent ?? "")
        .join("");

/** A cell reference like "C12" as a zero-based column index. */
const columnIndex = (ref: string): number => {
  const letters = (ref.match(/^[A-Z]+/)?.[0] ?? "A").toUpperCase();
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
};

/** The first worksheet as rows of text; empty cells are kept so columns line up. */
export const sheetRows = (bytes: Uint8Array): string[][] => {
  const files = unzip(bytes);
  const decoder = new TextDecoder();
  const sharedXml = files.get("xl/sharedStrings.xml");
  const shared: string[] = [];
  if (sharedXml) {
    const doc = new DOMParser().parseFromString(decoder.decode(sharedXml), "application/xml");
    for (const si of doc.querySelectorAll("si")) shared.push(textOf(si));
  }
  const sheetName = [...files.keys()]
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort((a, b) => Number(a.match(/(\d+)/)![1]) - Number(b.match(/(\d+)/)![1]))[0];
  if (!sheetName) throw new Error("No worksheet");
  const doc = new DOMParser().parseFromString(decoder.decode(files.get(sheetName)!), "application/xml");
  const rows: string[][] = [];
  for (const row of doc.querySelectorAll("row")) {
    const cells: string[] = [];
    for (const cell of row.querySelectorAll("c")) {
      const at = columnIndex(cell.getAttribute("r") ?? "A1");
      const type = cell.getAttribute("t");
      const value =
        type === "s"
          ? shared[Number(cell.querySelector("v")?.textContent ?? "-1")] ?? ""
          : type === "inlineStr"
            ? textOf(cell)
            : (cell.querySelector("v")?.textContent ?? "");
      while (cells.length < at) cells.push("");
      cells[at] = value;
    }
    rows.push(cells);
  }
  return rows;
};

/** The first worksheet as tab-separated text, so the table reader can take it. */
export const sheetAsTsv = (bytes: Uint8Array): string =>
  sheetRows(bytes)
    .map((cells) => cells.map((cell) => cell.replace(/\t/g, " ").replace(/\r?\n/g, " ")).join("\t"))
    .join("\n");
