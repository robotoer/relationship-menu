import { RelationshipMenuDocument } from "./model/menu";
import { sanitizePerson } from "./compare-slug";

/**
 * Represents a storage interface for managing RelationshipMenuDocuments.
 */
export type Storage = {
  ready(): boolean;

  /**
   * Retrieves RelationshipMenuDocuments from the storage.
   * @param id - Optional ID of the document to retrieve. If not provided, retrieves all documents.
   * @returns A Promise that resolves to an object containing the retrieved documents, where the keys are the document IDs.
   */
  getDocuments(
    id?: string
  ): Promise<{ [id: string]: RelationshipMenuDocument }>;

  /**
   * Saves RelationshipMenuDocuments to the storage.
   * @param docs - The RelationshipMenuDocuments to save.
   * @returns A Promise that resolves to an array of IDs of the saved documents.
   */
  saveDocuments(...docs: RelationshipMenuDocument[]): Promise<string[]>;

  /**
   * Deletes all RelationshipMenuDocument entries matching the given title from the storage.
   * This may remove multiple entries when the same title exists under different keys
   * (e.g., a raw localStorage entry and one or more CID-keyed IPFS entries).
   * @param title - The title of the document(s) to delete.
   * @returns A Promise that resolves when all matching entries are deleted.
   */
  deleteDocument(title: string): Promise<void>;

  /**
   * Clears all RelationshipMenuDocuments from the storage.
   * @returns A Promise that resolves when the storage is cleared.
   */
  clear(): Promise<void>;
};

/**
 * A menu document stored under a `menu:` key in localStorage. Two formats exist:
 * - IPFS storage: key `menu:<CID>`, value JSON `{ title, encoded, savedAt? }`.
 * - Plain local storage: key `menu:<title>`, value is the encoded menu itself.
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

/**
 * Writes `doc` to localStorage right away under a temporary `menu:pending:<title>`
 * key. Slower backends (IPFS) call this before their own write, so closing the tab
 * mid-save can't lose the edit: the Library reads pending entries like any other,
 * and the backend's final entry replaces it (via removeLocalMenuEntries).
 */
export const writePendingLocalCopy = (doc: RelationshipMenuDocument) => {
  const key = `menu:pending:${doc.title}`;
  localStorage.setItem(key, JSON.stringify({ ...doc, savedAt: Date.now() }));
  return key;
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
    // Drop other copies of this menu (e.g. older IPFS entries) so it isn't listed twice.
    removeLocalMenuEntries(doc.title, key);
    ids.push(doc.title);
  }
  return ids;
};

export const localStorageDeleteDocument = async (title: string) => {
  removeLocalMenuEntries(title);
};

const localStorageClear = async () => {
  localStorage.clear();
};

/**
 * Creates a local storage object.
 * @returns The local storage object.
 */
export const createLocalStorage = (): Storage => {
  return {
    ready: () => true,
    getDocuments: localStorageGetDocuments,
    saveDocuments: localStorageSaveDocuments,
    deleteDocument: localStorageDeleteDocument,
    clear: localStorageClear,
  };
};
