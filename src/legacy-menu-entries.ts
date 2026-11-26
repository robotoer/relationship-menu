/**
 * Reading menus saved by versions before menu ids (spec SV-6, SV-9). They're
 * migrated to id-keyed entries on load (menu-store.ts, SY-90); this module only
 * parses them.
 */

import { RelationshipMenuDocument } from "./model/menu";
import { sanitizePerson } from "./compare-slug";
import { ipfsPointerCid } from "./ipfs-recovery";

/**
 * A menu document stored under a `menu:` key in localStorage. Formats, all still read:
 * - Title-keyed: key `menu:<title>`, value JSON `{ title, encoded, savedAt, ... }`.
 * - Older IPFS-era copies: key `menu:<CID>` or `menu:pending:<title>`, same JSON.
 * - IPFS-era pointers (July 2024 to March 2026): key `menu:<CID>`, value only a date;
 *   the menu itself was in IndexedDB. Hidden until recovered (SY-91, ipfs-recovery.ts).
 * - Oldest: key `menu:<title>`, value is the encoded menu itself.
 * When a title has several entries, the most recently saved wins.
 */
export type LocalMenuEntry = {
  key: string;
  doc: RelationshipMenuDocument;
  /** When it was saved (ms since epoch), or 0 if unknown (older entries). */
  savedAt: number;
};

/** Parses one localStorage entry, or returns null if it isn't a menu entry. */
export const parseLocalMenuEntry = (
  key: string,
  value: string | null
): LocalMenuEntry | null => {
  if (!key.startsWith("menu:") || value === null) {
    return null;
  }
  // An IPFS-era pointer isn't a menu by itself; recovery turns it into one (SY-91).
  if (ipfsPointerCid(key, value)) {
    return null;
  }
  try {
    const parsed = JSON.parse(value);
    if (
      parsed &&
      typeof parsed.title === "string" &&
      typeof parsed.encoded === "string"
    ) {
      const doc: RelationshipMenuDocument = { title: parsed.title, encoded: parsed.encoded };
      if (typeof parsed.createdAt === "number") doc.createdAt = parsed.createdAt;
      if (typeof parsed.updatedAt === "number") doc.updatedAt = parsed.updatedAt;
      const person = sanitizePerson(parsed.person);
      if (person) doc.person = person;
      return {
        key,
        doc,
        savedAt:
          typeof parsed.savedAt === "number"
            ? parsed.savedAt
            : typeof parsed.updatedAt === "number"
            ? parsed.updatedAt
            : 0,
      };
    }
  } catch {
    // Not JSON: raw format.
  }
  return { key, doc: { title: key.slice(5), encoded: value }, savedAt: 0 };
};

/**
 * Picks one document per title. When a title has several entries (older versions
 * saved before duplicates were cleaned up), the most recently saved one wins.
 */
export const latestByTitle = (entries: LocalMenuEntry[]) => {
  // No prototype: titles are user text (e.g. "constructor").
  const best: { [title: string]: LocalMenuEntry } = Object.create(null);
  for (const entry of entries) {
    const current = best[entry.doc.title];
    if (!current || entry.savedAt >= current.savedAt) {
      best[entry.doc.title] = entry;
    }
  }
  return best;
};
