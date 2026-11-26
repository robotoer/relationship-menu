/**
 * Saving menus brought over from the old address without overwriting anything
 * (spec HO-5).
 *
 * - A menu identical to one already here is skipped: same items, answers, notes
 *   and person, under the same title or a numbered copy of it ("Title (2)", from
 *   an earlier hand-off of the same menu). So a repeated hand-off adds nothing.
 * - A menu whose title is taken by a different menu is added as a copy, "Title
 *   (2)", as when opening a link (LK-6).
 * - Everything else is added as it is.
 * Every added menu is new (no id: storage gives it one), so no existing menu is
 * ever changed. Incoming menus are untrusted: each is decoded and sanitized like
 * an opened link, and one that can't be read is left out.
 */

import { decodeCompareSlug, encodeMenuSlug } from "./compare-slug";
import { encodeData } from "./data-encoder";
import { isNumberedCopyOf, uniqueTitle } from "./menu-titles";
import { Person, RelationshipMenu, RelationshipMenuDocument } from "./model/menu";

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

/** The menus to add, in order. `existing` is never changed. */
export const planImport = (
  existing: readonly RelationshipMenuDocument[],
  incoming: readonly IncomingMenu[]
): RelationshipMenuDocument[] => {
  const titles = new Set(existing.map((doc) => doc.title));
  const here: { title: string; content: string }[] = existing.flatMap((doc) => {
    const readable = read(doc.title, doc.encoded, doc.person);
    return readable ? [{ title: doc.title, content: readable.content }] : [];
  });
  const added: RelationshipMenuDocument[] = [];
  for (const menu of incoming) {
    const readable = read(menu.title, menu.encoded, menu.person);
    if (!readable) continue;
    const alreadyHere = here.some(
      (doc) =>
        doc.content === readable.content &&
        (doc.title === readable.title || isNumberedCopyOf(doc.title, readable.title))
    );
    if (alreadyHere) continue;
    const title = titles.has(readable.title) ? uniqueTitle(readable.title, titles) : readable.title;
    const createdAt = timestamp(menu.createdAt);
    const updatedAt = timestamp(menu.updatedAt);
    added.push({
      title,
      encoded: encodeData(readable.menu),
      ...(readable.person ? { person: readable.person } : {}),
      ...(createdAt !== undefined ? { createdAt } : {}),
      ...(updatedAt !== undefined ? { updatedAt } : {}),
    });
    titles.add(title);
    here.push({ title, content: readable.content });
  }
  return added;
};
