/**
 * Menus made somewhere else (spec SV-16): relationshipmenu.org files, spreadsheets
 * (Google Sheets, Excel, Airtable), Google Forms responses and pasted outlines
 * (Markdown, Notion, plain lists).
 *
 * Everything here is pure: the file is read in the browser, nothing is uploaded, and
 * the result is the same menus the editor would save. `import-menus.ts` then applies
 * its usual rules (skip a menu already here, never overwrite, "Title (2)").
 *
 * The formats people actually have are loose, so each reader is deliberately
 * forgiving: any column order, any of the usual column names, and answers written as
 * words, glyphs or tick boxes. What it can't understand it leaves out rather than
 * guessing, and the summary says how many menus were read.
 */

import { Person, RelationshipMenu, RelationshipMenuItemValue } from "./model/menu";

/** A menu read from a file, before it gets a title or a saved id. */
export type ImportedMenu = {
  title: string;
  menu: RelationshipMenu;
  person?: Person;
};

export type FormatSource = "relationshipmenu" | "table" | "outline";

export type FormatImport = {
  source: FormatSource;
  menus: ImportedMenu[];
  /** Rows, sections or items the reader couldn't use, for an honest summary. */
  skipped: number;
};

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/** Words people answer with, in every spelling we've seen, mapped to our four values. */
const ANSWER_WORDS: [RegExp, RelationshipMenuItemValue][] = [
  [/^(must|must[-\s]?have|must have|need|needed|required|essential|yes|yep|definitely|absolutely|😍|❤️|♥️|⭐|🌟|★|✅|✔️|☑️|✔|🔴|2)$/i, "must-have"],
  [
    /^(like|like[-\s]?to[-\s]?have|like to have|would like|want|wanted|prefer|preferred|happy with|nice to have|would be nice|🙂|😊|👍|💚|💙|🟢|✅✅|⭕|1)$/i,
    "like-to-have",
  ],
  [/^(maybe|perhaps|unsure|not sure|open|open to it|sometimes|it depends|depends|neut(ral)?|🤷|🤔|❔|❓|❓❓|❓❌❓|🟡|0)$/i, "maybe"],
  [/^(soft[\s-]?no|rather not|would rather not|prefer not|i'd rather not|leaning no|not really|🔶|🟠)$/i, "soft-no"],
  [
    /^(off|off[-\s]?limits|off limits|no|nope|never|hard no|not for me|boundary|deal ?breaker|🚫|⛔|❌|✖️|✖|✕|✗|🛑|🔴)$/i,
    "off-limits",
  ],
];

/** Our value for an answer as written, or undefined (blank, a dash, "n/a"). */
export const answerValue = (raw: unknown): RelationshipMenuItemValue | undefined => {
  if (typeof raw !== "string" && typeof raw !== "number") return undefined;
  const value = String(raw)
    .replace(/[()[\]{}"'.:;!*_`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!value || /^(n\/?a|none|null|-|—|–|\?)$/i.test(value)) return undefined;
  for (const [pattern, answer] of ANSWER_WORDS) if (pattern.test(value)) return answer;
  return undefined;
};

const newMenu = (): RelationshipMenu => Object.create(null) as RelationshipMenu;

/** Adds an item, keeping the first answer and note when a file repeats it. */
const addItem = (
  menu: RelationshipMenu,
  group: string,
  item: string,
  value?: RelationshipMenuItemValue,
  note?: string
) => {
  const name = group.trim() || "Menu";
  const label = item.replace(/\s+/g, " ").trim();
  if (!label) return;
  const items = (menu[name] ??= []);
  const existing = items.find((entry) => entry.item.toLowerCase() === label.toLowerCase());
  if (existing) {
    existing.value ??= value;
    if (!existing.note && note) existing.note = note;
    return;
  }
  items.push({ item: label, ...(value ? { value } : {}), ...(note ? { note } : {}) });
};

const countItems = (menu: RelationshipMenu) =>
  Object.values(menu).reduce((total, items) => total + (Array.isArray(items) ? items.length : 0), 0);

const hasAnswers = (menu: RelationshipMenu) =>
  Object.values(menu).some((items) => items?.some((item) => item.value !== undefined));

// ---- CSV, TSV and spreadsheet exports -------------------------------------------

/** One row of cells. Quoted cells keep their commas, quotes and line breaks (RFC 4180). */
export const parseRows = (input: string): string[][] => {
  const source = input.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const delimiter = pickDelimiter(source);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += char;
      continue;
    }
    if (char === '"' && cell.trim() === "") {
      quoted = true;
      cell = "";
    } else if (char === delimiter) {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((value) => value.trim() !== ""));
};

/** Tabs when the first line has more of them, then semicolons, then commas. */
const pickDelimiter = (source: string) => {
  const firstLine = source.slice(0, source.indexOf("\n") + 1 || source.length);
  const count = (char: string) => firstLine.split(char).length - 1;
  const tabs = count("\t");
  const semicolons = count(";");
  const commas = count(",");
  if (tabs > commas && tabs > semicolons) return "\t";
  return semicolons > commas ? ";" : ",";
};

/** Column names, normalised, so "Category ", "GROUP" and "Section" all match. */
const HEADER_ALIASES = {
  group: ["group", "category", "categories", "section", "area", "topic", "theme", "type"],
  item: ["item", "items", "activity", "activities", "question", "questions", "action", "thing", "name", "statement"],
  answer: ["answer", "answers", "preference", "preferences", "value", "importance", "rating", "response", "choice", "level"],
  note: ["note", "notes", "comment", "comments", "detail", "details", "why", "explanation"],
  person: ["person", "people", "who", "respondent", "partner", "author"],
  title: ["title", "menu", "menu title", "name of menu"],
} as const;

const normalizeHeader = (header: string) =>
  header
    .toLowerCase()
    .replace(/[_[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const headerIndex = (headers: string[], kind: keyof typeof HEADER_ALIASES) =>
  headers.findIndex((header) => (HEADER_ALIASES[kind] as readonly string[]).includes(normalizeHeader(header)));

/**
 * Reads a spreadsheet as one menu, or one menu per person when the answers are
 * side by side (a column each) or one per row (a Google Form response).
 */
export const parseTable = (input: string, fallbackTitle: string): FormatImport | null => {
  const rows = parseRows(input);
  if (rows.length < 2) return null;
  const headers = rows[0].map((header) => header.trim());
  if (headers.length < 2) return null;

  const groupAt = headerIndex(headers, "group");
  let itemAt = headerIndex(headers, "item");
  const answerAt = headerIndex(headers, "answer");
  const noteAt = headerIndex(headers, "note");
  const personAt = headerIndex(headers, "person");
  const titleAt = headerIndex(headers, "title");
  const body = rows.slice(1);

  // "Item, Group, Answer" (one menu) — also covers "Question, Answer" with no group.
  if (itemAt >= 0 && (answerAt >= 0 || (groupAt >= 0 && noteAt >= 0))) {
    return { source: "table", menus: [rowsAsOneMenu()], skipped: 0 };

    function rowsAsOneMenu(): ImportedMenu {
      const menu = newMenu();
      let skipped = 0;
      for (const cells of body) {
        const item = text(cells[itemAt]);
        if (!item) {
          skipped++;
          continue;
        }
        const value = answerAt >= 0 ? answerValue(cells[answerAt]) : undefined;
        // A spreadsheet with an Answer column but nothing in it is an unfilled row,
        // not an item: outlines are the place for items with no answer.
        if (answerAt >= 0 && value === undefined) {
          skipped++;
          continue;
        }
        addItem(
          menu,
          groupAt >= 0 ? text(cells[groupAt]) : "",
          item,
          value,
          noteAt >= 0 ? text(cells[noteAt]) : undefined
        );
      }
      const person = personAt >= 0 ? text(body[0]?.[personAt]) : "";
      return {
        title: (titleAt >= 0 ? text(body[0]?.[titleAt]) : "") || person || fallbackTitle,
        menu,
        ...(person ? { person: { name: person } } : {}),
        skipped,
      } as ImportedMenu & { skipped: number };
    }
  }

  const grid = parseSectionGrid(rows, fallbackTitle);
  if (grid) return grid;

  const nameAt =
    personAt >= 0
      ? personAt
      : headers.findIndex((h) => /^(name|your name|who are you|respondent)$/i.test(normalizeHeader(h)));
  const emailAt = headers.findIndex((h) => /^e ?mail( address)?$/i.test(normalizeHeader(h)));
  // In a form, "Name" is the respondent, not the item, even though both are "name".
  const itemIsPerson = itemAt >= 0 && nameAt === itemAt;
  if (itemIsPerson) itemAt = -1;
  const ignore = new Set([groupAt, itemAt, noteAt, personAt, titleAt, nameAt, emailAt].filter((index) => index >= 0));
  const valueColumns = headers.map((_, index) => index).filter((index) => !ignore.has(index));

  // One question per item, repeated per person: "Weekly time together (Ana)" and
  // "Weekly time together (Ben)". Each person gets their own menu.
  const byPerson = new Map<string, ImportedMenu>();
  for (const column of valueColumns) {
    const parsed = stripPersonSuffix(headers[column] ?? "");
    if (!parsed.person) continue;
    const entry = byPerson.get(parsed.person) ?? { title: parsed.person, menu: newMenu(), person: { name: parsed.person } };
    for (const cells of body) {
      const value = answerValue(cells[column]);
      if (value === undefined) continue;
      addItem(entry.menu, groupAt >= 0 ? text(cells[groupAt]) : "", parsed.item, value, noteAt >= 0 ? text(cells[noteAt]) : undefined);
    }
    byPerson.set(parsed.person, entry);
  }
  if (byPerson.size >= 2) {
    const grouped = [...byPerson.values()].filter((entry) => countItems(entry.menu) > 0);
    if (grouped.length >= 2) return { source: "table", menus: grouped, skipped: 0 };
  }

  // A Google Form: a row per respondent, a column per question. Each respondent is
  // that person's own menu, titled with their name (or their email).
  if (groupAt < 0 && itemAt < 0 && valueColumns.length >= 2) {
    const menus: ImportedMenu[] = [];
    let skipped = 0;
    for (const cells of body) {
      if (!cells.some((cell) => text(cell))) continue;
      const menu = newMenu();
      let used = 0;
      for (const column of valueColumns) {
        const header = headers[column]?.trim();
        const value = answerValue(cells[column]);
        if (!header || value === undefined) continue;
        addItem(menu, groupAt >= 0 ? text(cells[groupAt]) : "", stripPersonSuffix(header).item, value, noteAt >= 0 ? text(cells[noteAt]) : undefined);
        used++;
      }
      if (used === 0) {
        skipped++;
        continue;
      }
      const name = (nameAt >= 0 ? text(cells[nameAt]) : "") || (emailAt >= 0 ? text(cells[emailAt]) : "") || fallbackTitle;
      menus.push({ title: name, menu, person: { name } });
    }
    if (menus.length > 0) return { source: "table", menus, skipped };
    return null;
  }

  // Answers side by side, one column per person: "Item", then "Ana", "Ben".
  if (itemAt >= 0 || groupAt >= 0) {
    const itemColumn = itemAt >= 0 ? itemAt : valueColumns[0];
    const columns = headers.map((_, index) => index).filter((index) => index !== itemColumn && index !== groupAt && index !== noteAt && index !== titleAt);
    const menus = columns.map((column) => {
      const menu = newMenu();
      for (const cells of body) {
        const item = text(cells[itemColumn]);
        if (!item) continue;
        const value = answerValue(cells[column]);
        if (value === undefined) continue;
        addItem(menu, groupAt >= 0 ? text(cells[groupAt]) : "", item, value, noteAt >= 0 ? text(cells[noteAt]) : undefined);
      }
      const person = headers[column]?.trim() || fallbackTitle;
      return { title: person, menu, person: { name: person } } as ImportedMenu;
    });
    const usable = menus.filter((entry) => countItems(entry.menu) > 0);
    if (usable.length > 0) return { source: "table", menus: usable, skipped: menus.length - usable.length };
  }
  return null;
};

/** "Weekly time together (Ana)" or "Ana — Weekly time together": the other person's column. */
const stripPersonSuffix = (header: string): { item: string; person?: string } => {
  const bracketed = header.match(/^(.*?)\s*[[(]\s*([^)\]]{1,40})\s*[)\]]$/);
  if (bracketed) return { item: bracketed[1].trim() || header, person: bracketed[2].trim() };
  const dashed = header.match(/^([^—–:|]{1,30})\s*[—–:|]\s*(.+)$/);
  if (dashed) return { item: dashed[2].trim(), person: dashed[1].trim() };
  return { item: header };
};

/** "C O M M I T M E N T" stretched across a row, as these sheets type it. */
const tidyTitle = (raw: string): string => {
  const words = raw.trim().split(/\s{2,}/);
  return words
    .map((word) => (/^(?:\S )+\S$/.test(word) ? word.replace(/ /g, "") : word.replace(/\s+/g, " ")))
    .filter(Boolean)
    .map((word) =>
      word === word.toUpperCase() && word.length > 1 ? word[0] + word.slice(1).toLowerCase() : word
    )
    .join(" ");
};

/** A cell that is only a glyph (⬜, a tick, an emoji): status, never a title or item. */
const glyphOnly = (value: string) => !/[\p{L}\p{N}]/u.test(value);

/**
 * A spreadsheet laid out in side-by-side sections, the way the widely shared
 * "non-escalator relationship menu" sheets are: an answer (often an emoji) in one
 * column and its item in the next, repeated across the page, with a section title
 * appearing in that same answer column when a section starts. Each title applies to
 * the items below it in its own columns.
 *
 * The sheet's preamble (instructions, a legend of what each glyph means) is skipped:
 * reading starts two rows above the first row that holds an answer and its item.
 */
export const parseSectionGrid = (rows: string[][], fallbackTitle: string): FormatImport | null => {
  const isItemRow = (cells: string[]) =>
    cells.some((cell, column) => {
      const answer = answerValue(text(cell));
      if (!answer) return false;
      const next = text(cells[column + 1] ?? "");
      return !!next && answerValue(next) === undefined && !glyphOnly(next);
    });
  const firstItem = rows.findIndex(isItemRow);
  if (firstItem < 0) return null;

  const menu = newMenu();
  const groupForColumn = new Map<number, string>();
  let items = 0;
  for (const cells of rows.slice(Math.max(0, firstItem - 2))) {
    for (let column = 0; column < cells.length; column++) {
      const value = text(cells[column]);
      if (!value) continue;
      const answer = answerValue(value);
      // A glyph that isn't an answer (⬜, a stray tick) is status, not a title.
      if (!answer && glyphOnly(value)) continue;
      const next = text(cells[column + 1] ?? "");
      if (answer && next && answerValue(next) === undefined && !glyphOnly(next)) {
        addItem(menu, groupForColumn.get(column) ?? "", next, answer);
        items++;
        continue;
      }
      // A title: no answer, a short label, and nothing beside it.
      if (!answer && !next && value.length <= 40 && !/[.:;!?]$/.test(value)) {
        groupForColumn.set(column, tidyTitle(value));
      }
    }
  }
  if (items < 5) return null;
  return { source: "table", menus: [{ title: fallbackTitle, menu }], skipped: 0 };
};

// ---- relationshipmenu.org files --------------------------------------------------

type AnyRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is AnyRecord => typeof value === "object" && value !== null && !Array.isArray(value);

/** English text from `"Name"` or `{ en: "Name" }` (their templates are multilingual). */
const localized = (value: unknown): string => {
  if (typeof value === "string") return value.trim();
  if (!isRecord(value)) return "";
  return text(value.en) || text(Object.values(value).find((entry) => typeof entry === "string"));
};

/** The note as their files hold it: a string, `[{ text }]`, or `{ text }`. */
const theirNote = (value: unknown): string => {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return value.map(theirNote).filter(Boolean).join(" ").trim();
  if (isRecord(value)) return text(value.text);
  return "";
};

/**
 * A person's answers in their file. Their schema has changed over versions, so the
 * answer for an item is looked for in the places a saved menu has used: next to the
 * item, or in the person's own response, by item name or by position.
 */
const personAnswers = (person: AnyRecord, items: { name: string; group: string }[]): Map<string, RelationshipMenuItemValue> => {
  const answers = new Map<string, RelationshipMenuItemValue>();
  const put = (key: string, raw: unknown) => {
    const value = answerValue(raw);
    const item = key.trim().toLowerCase();
    if (value && item && !answers.has(item)) answers.set(item, value);
  };
  const walk = (source: unknown) => {
    if (Array.isArray(source)) {
      source.forEach((entry, index) => {
        if (isRecord(entry)) {
          const key = text(entry.name) || text(entry.item) || text(entry.title) || text(entry.id) || items[index]?.name;
          if (key) put(key, entry.preference ?? entry.value ?? entry.answer ?? entry.level ?? entry.response);
          return;
        }
        const value = answerValue(entry);
        if (value && items[index]) answers.set(items[index].name.toLowerCase(), value);
      });
      return;
    }
    if (isRecord(source)) {
      for (const [key, entry] of Object.entries(source)) {
        if (isRecord(entry)) put(key, entry.preference ?? entry.value ?? entry.answer ?? entry.level);
        else put(key, entry);
      }
    }
  };
  for (const key of ["preferences", "preference", "answers", "answer", "response", "responses", "items", "values"]) {
    walk(person[key]);
  }
  return answers;
};

/**
 * A relationshipmenu.org menu file: `.json`, `.rmenu` or `.relationshipmenu`, any
 * schema version they've shipped. One menu per person on it; a file with no people
 * is one menu with whatever answers its items carry.
 */
export const parseRelationshipMenuFile = (input: string, fallbackTitle: string): FormatImport | null => {
  let data: unknown;
  try {
    data = JSON.parse(input);
  } catch {
    return null;
  }
  if (!isRecord(data)) return null;
  const sections = data.menu ?? data.sections ?? data.categories;
  if (!Array.isArray(sections)) return null;

  type Entry = { group: string; name: string; note: string; value?: RelationshipMenuItemValue };
  const entries: Entry[] = [];
  let skipped = 0;
  for (const section of sections) {
    if (!isRecord(section)) {
      skipped++;
      continue;
    }
    const group = localized(section.name) || localized(section.title) || "Menu";
    const items = Array.isArray(section.items) ? section.items : [];
    for (const item of items) {
      if (!isRecord(item)) {
        skipped++;
        continue;
      }
      const name = localized(item.name) || localized(item.title) || localized(item.text);
      if (!name) {
        skipped++;
        continue;
      }
      entries.push({
        group,
        name,
        note: theirNote(item.note),
        value: answerValue(item.preference ?? item.value ?? item.answer),
      });
    }
  }
  if (entries.length === 0) return null;

  const people = Array.isArray(data.people) ? data.people.filter(isRecord) : [];
  const reference = entries.map((entry) => ({ name: entry.name, group: entry.group }));
  if (people.length === 0) {
    const menu = newMenu();
    for (const entry of entries) addItem(menu, entry.group, entry.name, entry.value, entry.note);
    return { source: "relationshipmenu", menus: [{ title: fallbackTitle, menu }], skipped };
  }
  const menus = people.map((person) => {
    const menu = newMenu();
    const answers = personAnswers(person, reference);
    for (const entry of entries) {
      const value = entry.value ?? answers.get(entry.name.toLowerCase());
      addItem(menu, entry.group, entry.name, value, entry.note);
    }
    const name = localized(person.name) || localized(person.display_name) || localized(person.author) || fallbackTitle;
    const personInfo: Person = { name };
    if (!hasAnswers(menu)) {
      // Read, but with nothing answered: still a menu, like a template.
      return { title: name, menu, person: personInfo } as ImportedMenu;
    }
    return { title: name, menu, person: personInfo } as ImportedMenu;
  });
  return { source: "relationshipmenu", menus, skipped };
};

// ---- Markdown, Notion and plain lists -------------------------------------------

const BULLET = /^\s*(?:[-*+•·▪▫◦]|\[[ xX✓]?\]|[☐☑□✓✔])?\s*/;
const HEADING = /^\s*(#{1,6}\s*|>\s*)?(.+?)\s*$/;

/** A trailing or leading answer written next to an item, in any of the usual shapes. */
const splitAnswer = (raw: string): { item: string; value?: RelationshipMenuItemValue } => {
  const line = raw.trim();
  const patterns: RegExp[] = [
    /^(.*?)\s*[-–—:|]\s*(.+)$/,
    /^(.*?)\s*\((must[- ]?have|like[- ]?to[- ]?have|maybe|off[- ]?limits)[^)]*\)$/i,
    /^(.*?)\s*\[([^\]]+)\]$/,
    /^(.+?)\s+\((.*?)\)$/,
  ];
  for (const pattern of patterns) {
    const match = line.match(pattern);
    if (!match) continue;
    const value = answerValue(match[2]);
    if (value) return { item: match[1].trim(), value };
  }
  const words = line.split(/\s+/);
  const tail = answerValue(words.slice(-2).join(" "));
  if (tail && words.length > 2) return { item: words.slice(0, -2).join(" "), value: tail };
  const last = answerValue(words[words.length - 1]);
  if (last && words.length > 1) return { item: words.slice(0, -1).join(" "), value: last };
  return { item: line };
};

/**
 * A pasted outline: "## Group" lines with bullets or lines under them, and answers
 * written at the end of an item ("Weekly time together — must have", "ü (must have)").
 * A line with no bullet that ends in a colon is a group too, so Notion and Google Docs
 * pastes work without their formatting.
 */
export const parseOutline = (input: string, fallbackTitle: string): FormatImport | null => {
  const lines = input.replace(/\r\n?/g, "\n").split("\n");
  const menu = newMenu();
  let group = "";
  let skipped = 0;
  let items = 0;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    const heading = line.match(/^#{1,6}\s+(.+?)\s*#*$/);
    if (heading) {
      group = heading[1].trim();
      continue;
    }
    const isBullet = /^\s*(?:[-*+•·▪▫◦]|\[[ xX✓]?\]|[☐☑□✓✔])\s*/.test(line);
    const body = line.replace(BULLET, "").trim();
    if (!body) continue;
    if (!isBullet && /:$/.test(body) && body.length <= 60) {
      group = body.replace(/:$/, "").trim();
      continue;
    }
    const { item, value } = splitAnswer(body);
    if (!item) {
      skipped++;
      continue;
    }
    addItem(menu, group, item, value);
    items++;
  }
  if (items === 0) return null;
  return { source: "outline", menus: [{ title: fallbackTitle, menu }], skipped };
};

// ---- One entry point ------------------------------------------------------------

export type MenuFileKind = "json" | "table" | "outline";

/** What a chosen file is, from its name and (when that says nothing) its first bytes. */
export const fileKind = (fileName: string, content: string): MenuFileKind => {
  const name = fileName.toLowerCase();
  if (/\.(rmenu|relationshipmenu|json)$/.test(name)) return "json";
  if (/\.(csv|tsv)$/.test(name)) return "table";
  if (/\.(md|markdown|txt)$/.test(name)) return "outline";
  const head = content.trimStart();
  if (/^[[{]/.test(head)) return "json";
  if (head.includes(",") && head.split("\n")[0].split(",").length >= 2) return "table";
  return "outline";
};

const fieldCount = (line: string) => (line.match(/[,\t;]/g)?.length ?? 0) + 1;

/** The menu title a file suggests: its name without the extension, tidied. */
export const titleFromFileName = (fileName: string): string => {
  const base = fileName.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
  return base ? base.replace(/\b\w/g, (letter) => letter.toUpperCase()) : "Imported menu";
};

/**
 * Reads a chosen file (SV-16). Tries the reader its name points at, then the others,
 * so a mislabelled export still works. Returns null when nothing in it is a menu.
 */
export const readMenuFile = (content: string, fileName: string): FormatImport | null => {
  const fallbackTitle = titleFromFileName(fileName);
  const readers: Record<MenuFileKind, () => FormatImport | null> = {
    json: () => parseRelationshipMenuFile(content, fallbackTitle),
    table: () => parseTable(content, fallbackTitle),
    outline: () => parseOutline(content, fallbackTitle),
  };
  const looksLikeJson = /^[[{]/.test(content.trimStart());
  const lines = content.trimStart().split(/\r?\n/);
  const first: MenuFileKind = looksLikeJson
    ? "json"
    : lines.length >= 2 && /[,\t;]/.test(lines[0]) && fieldCount(lines[0]) >= 2 && fieldCount(lines[1]) >= 2
      ? "table"
      : fileKind(fileName, content);
  const order: MenuFileKind[] = [first, ...(["json", "table", "outline"] as MenuFileKind[]).filter((kind) => kind !== first)];
  for (const kind of order) {
    const result = readers[kind]();
    if (result && result.menus.some((entry) => countItems(entry.menu) > 0)) return result;
  }
  return null;
};

/** Items in every menu read, for the summary. */
export const importedItemCount = (menus: readonly ImportedMenu[]) =>
  menus.reduce((total, entry) => total + countItems(entry.menu), 0);
