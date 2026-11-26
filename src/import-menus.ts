/**
 * Saving menus that come from elsewhere without overwriting anything: from the old
 * address's hand-off (spec HO-5), and from "Import menus" in the Library, which
 * reads pasted menu links or the file "Export all menus" makes (SV-14).
 *
 * - A menu identical to one already here is skipped: same items, answers, notes
 *   and person, under the same title or a numbered copy of it ("Title (2)", from
 *   an earlier import of the same menu). So a repeated import adds nothing.
 * - A menu whose title is taken by a different menu is added as a copy, "Title
 *   (2)", as when opening a link (LK-6).
 * - Everything else is added as it is.
 * Every added menu is new (no id: storage gives it one), so no existing menu is
 * ever changed. Incoming menus are untrusted: each is decoded and sanitized like
 * an opened link, and one that can't be read is left out.
 */

import { decodeCompareSlug, encodeMenuSlug, expandCompareEntry } from "./compare-slug";
import { encodeData } from "./data-encoder";
import { isNumberedCopyOf, uniqueTitle } from "./menu-titles";
import { Person, RelationshipMenu, RelationshipMenuDocument } from "./model/menu";
import type { Storage } from "./storage";

export type IncomingMenu = {
  title: string;
  encoded: string;
  person?: unknown;
  createdAt?: number;
  updatedAt?: number;
};

type Readable = { title: string; menu: RelationshipMenu; person?: Person; content: string };

/** A menu decoded and sanitized as an opened link would be, or null if unreadable. */
const read = (title: string, encoded: string, person: unknown): Readable | null => {
  try {
    const decoded = decodeCompareSlug(encodeMenuSlug(title, encoded, person as Person | undefined));
    if (!decoded) return null;
    return {
      title: decoded.title,
      menu: decoded.menu,
      ...(decoded.person ? { person: decoded.person } : {}),
      // Groups, items, answers, notes and person; not the title or dates.
      content: JSON.stringify([decoded.menu, decoded.person ?? null]),
    };
  } catch {
    return null;
  }
};

const timestamp = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined);

export type ImportPlan = {
  /** The menus to add, in order. */
  add: RelationshipMenuDocument[];
  /** Readable incoming menus left out because they're already here (or came earlier in the list). */
  alreadyHere: number;
  /** Menus added under a new title because theirs was taken: the title they came with, and the one given. */
  renamed: { from: string; to: string }[];
};

/** What importing `incoming` into a library holding `existing` adds. `existing` is never changed. */
const plan = (existing: readonly RelationshipMenuDocument[], incoming: readonly IncomingMenu[]): ImportPlan => {
  const titles = new Set(existing.map((doc) => doc.title));
  const here: { title: string; content: string }[] = existing.flatMap((doc) => {
    const readable = read(doc.title, doc.encoded, doc.person);
    return readable ? [{ title: doc.title, content: readable.content }] : [];
  });
  const result: ImportPlan = { add: [], alreadyHere: 0, renamed: [] };
  for (const menu of incoming) {
    const readable = read(menu.title, menu.encoded, menu.person);
    if (!readable) continue;
    const alreadyHere = here.some(
      (doc) =>
        doc.content === readable.content &&
        (doc.title === readable.title || isNumberedCopyOf(doc.title, readable.title))
    );
    if (alreadyHere) {
      result.alreadyHere++;
      continue;
    }
    const title = titles.has(readable.title) ? uniqueTitle(readable.title, titles) : readable.title;
    if (title !== readable.title) result.renamed.push({ from: readable.title, to: title });
    const createdAt = timestamp(menu.createdAt);
    const updatedAt = timestamp(menu.updatedAt);
    result.add.push({
      title,
      encoded: encodeData(readable.menu),
      ...(readable.person ? { person: readable.person } : {}),
      ...(createdAt !== undefined ? { createdAt } : {}),
      ...(updatedAt !== undefined ? { updatedAt } : {}),
    });
    titles.add(title);
    here.push({ title, content: readable.content });
  }
  return result;
};

/** The menus to add, in order. `existing` is never changed. */
export const planImport = (
  existing: readonly RelationshipMenuDocument[],
  incoming: readonly IncomingMenu[]
): RelationshipMenuDocument[] => plan(existing, incoming).add;

// ---- Import menus in the Library (SV-14) ----

/** Characters a menu slug is made of: base64 (and, inside a link, percent-encoded base64). */
const NOT_SLUG_START = /^[^A-Za-z0-9+/=]+/;
const NOT_SLUG_END = /[^A-Za-z0-9+/=]+$/;
/**
 * A bare menu slug, `title:menu` or `title:menu:about`. Each part is compressed
 * base64, at least 12 characters even for an empty title, so a time ("10:30") or
 * "Re:Hi" in pasted text isn't taken for one.
 */
const BARE_SLUG = /^[A-Za-z0-9+/=]{12,}:[A-Za-z0-9+/=]{12,}(?::[A-Za-z0-9+/=]{12,})?$/;

/**
 * Every menu entry in pasted text or a backup file (SV-14), one per menu: menu
 * links (anything with `encoded=`, from any address: this one, the old one, a
 * test server), each menu of a compare link that holds several, and bare menu
 * slugs. Everything else (the backup's header, titles, numbering, words around a
 * pasted link) is ignored. Punctuation stuck to a link, like a full stop after it
 * or the brackets around it, is left off. Entries aren't decoded here.
 */
export const menuEntries = (text: string): string[] =>
  text.split(/\s+/).flatMap((word) => {
    const token = word.replace(NOT_SLUG_START, "").replace(NOT_SLUG_END, "");
    if (token.includes("encoded=")) return expandCompareEntry(token);
    return BARE_SLUG.test(token) ? [token] : [];
  });

export type TextImport = ImportPlan & {
  /** Menus read from the text, whether added or already here. */
  found: number;
  /** Entries that looked like menu links but couldn't be read (cut off, or not a menu). */
  unreadable: number;
};

/**
 * SV-14: what importing pasted text or a backup file into a library holding
 * `existing` adds, following HO-5's rules. Each added menu is dated `now`, like a
 * link opened in the editor and saved for the first time (SV-8). Never throws.
 */
export const planTextImport = (
  existing: readonly RelationshipMenuDocument[],
  text: string,
  now: number
): TextImport => {
  const entries = menuEntries(text);
  const incoming: IncomingMenu[] = [];
  for (const entry of entries) {
    const decoded = decodeCompareSlug(entry);
    if (!decoded) continue;
    incoming.push({
      title: decoded.title,
      encoded: encodeData(decoded.menu),
      ...(decoded.person ? { person: decoded.person } : {}),
      createdAt: now,
      updatedAt: now,
    });
  }
  return { ...plan(existing, incoming), found: incoming.length, unreadable: entries.length - incoming.length };
};

/**
 * Imports pasted text or a backup file into `storage` (SV-14): reads what's saved
 * now, adds only new menus, and rejects if they couldn't all be saved.
 */
export const importMenuText = async (
  storage: Pick<Storage, "getDocuments" | "saveDocuments">,
  text: string,
  now = Date.now()
): Promise<TextImport> => {
  const result = planTextImport(Object.values(await storage.getDocuments()), text, now);
  if (result.add.length > 0) {
    const ids = await storage.saveDocuments(...result.add);
    if (ids.length !== result.add.length) throw new Error("Imported menus weren't saved");
  }
  return result;
};

const menus = (n: number) => `${n} menu${n === 1 ? "" : "s"}`;
const was = (n: number) => (n === 1 ? "was" : "were");
const shownTitle = (title: string) => `"${title || "Untitled menu"}"`;

/** SV-14: the plain summary shown after an import, e.g. "Added 3 menus, 1 was already here." */
export const importSummary = ({ add, alreadyHere, renamed, found, unreadable }: TextImport): string => {
  if (found === 0) {
    if (unreadable === 0) {
      return "No menu links found. Paste a menu link, or choose a file made with Export all menus.";
    }
    return unreadable === 1
      ? "That link couldn't be read. It may have been cut off when it was copied."
      : `${unreadable} links couldn't be read. They may have been cut off when they were copied.`;
  }
  const parts: string[] = [];
  if (add.length === 0) {
    parts.push(`Nothing new: ${menus(alreadyHere)} ${was(alreadyHere)} already here.`);
  } else {
    parts.push(
      alreadyHere > 0
        ? `Added ${menus(add.length)}, ${alreadyHere} ${was(alreadyHere)} already here.`
        : `Added ${menus(add.length)}.`
    );
  }
  if (renamed.length === 1) {
    parts.push(
      `You already had a menu called ${shownTitle(renamed[0].from)}, so the new one is ${shownTitle(renamed[0].to)}.`
    );
  } else if (renamed.length > 1) {
    parts.push(`${renamed.length} were added as copies, like "Title (2)", because their titles were taken.`);
  }
  if (unreadable > 0) {
    parts.push(`${unreadable} link${unreadable === 1 ? "" : "s"} couldn't be read.`);
  }
  return parts.join(" ");
};
