import { RelationshipMenuDocument } from "./model/menu";
import { sanitizePerson } from "./compare-slug";
import { ipfsPointerCid, recoverIpfsMenus } from "./ipfs-recovery";

/**
 * Represents a storage interface for managing RelationshipMenuDocuments.
 */
export type Storage = {
  /** Menus by title; with an `id` (a title), only that one (if it exists). */
  getDocuments(id?: string): Promise<{ [id: string]: RelationshipMenuDocument }>;
  /** Saves menus; resolves to their ids (titles), or an empty list if saving failed. */
  saveDocuments(...docs: RelationshipMenuDocument[]): Promise<string[]>;
  /** Removes every stored copy of the menu with this title. */
  deleteDocument(title: string): Promise<void>;
};

/**
 * A menu document stored under a `menu:` key in localStorage. Formats, all still read:
 * - Current: key `menu:<title>`, value JSON `{ title, encoded, savedAt, ... }`.
 * - Older IPFS-era copies: key `menu:<CID>` or `menu:pending:<title>`, same JSON.
 * - IPFS-era pointers (July 2024 to March 2026): key `menu:<CID>`, value only a date;
 *   the menu itself was in IndexedDB. Hidden until recovered (SY-91, ipfs-recovery.ts).
 * - Oldest: key `menu:<title>`, value is the encoded menu itself.
 * When a title has several entries, the most recently saved wins, and the next
 * save removes the others.
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

/** Every menu entry currently in localStorage. */
export const readLocalMenuEntries = (): LocalMenuEntry[] => {
  const entries: LocalMenuEntry[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key) {
      const entry = parseLocalMenuEntry(key, localStorage.getItem(key));
      if (entry) entries.push(entry);
    }
  }
  return entries;
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

/** Removes every localStorage entry for `title`, except the one stored under `exceptKey`. */
export const removeLocalMenuEntries = (title: string, exceptKey?: string) => {
  for (const entry of readLocalMenuEntries()) {
    if (entry.doc.title === title && entry.key !== exceptKey) {
      localStorage.removeItem(entry.key);
    }
  }
};

const localStorageGetDocuments = async (id?: string) => {
  const documents: { [id: string]: RelationshipMenuDocument } = Object.create(null);
  for (const [title, entry] of Object.entries(
    latestByTitle(readLocalMenuEntries())
  )) {
    if (id === undefined || id === title) {
      documents[title] = entry.doc;
    }
  }
  return documents;
};

const localStorageSaveDocuments = async (
  ...docs: RelationshipMenuDocument[]
): Promise<string[]> => {
  const ids: string[] = [];
  for (const doc of docs) {
    const key = `menu:${doc.title}`;
    // JSON (not the bare encoded menu) so dates and person info are kept.
    localStorage.setItem(key, JSON.stringify({ ...doc, savedAt: Date.now() }));
    // Drop other copies of this menu (e.g. IPFS-era entries) so it isn't listed twice.
    removeLocalMenuEntries(doc.title, key);
    ids.push(doc.title);
  }
  return ids;
};

export const localStorageDeleteDocument = async (title: string) => {
  removeLocalMenuEntries(title);
};

/**
 * Creates a local storage object.
 * @returns The local storage object.
 */
export const createLocalStorage = (): Storage => {
  // Before the first read, bring back menus only the IPFS version kept (SY-91).
  // Never fails: if IndexedDB is unavailable, those menus just stay hidden.
  let recovery: Promise<unknown> | null = null;
  const recovered = () => (recovery ??= recoverIpfsMenus().catch(() => 0));
  return {
    getDocuments: async (id?: string) => {
      await recovered();
      return localStorageGetDocuments(id);
    },
    saveDocuments: localStorageSaveDocuments,
    deleteDocument: localStorageDeleteDocument,
  };
};
