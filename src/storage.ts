import { RelationshipMenuDocument } from "./model/menu";

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

// Implementation of the `Storage` type that uses the browser's `localStorage`
// but still hashes using the IPFS algorithm:

const localStorageGetDocuments = async (id?: string) => {
  const documents: { [id: string]: RelationshipMenuDocument } = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith("menu:")) {
      const value = localStorage.getItem(key);
      if (value) {
        // Try to parse as JSON first (IPFS format stores {title, encoded} as JSON)
        try {
          const parsed = JSON.parse(value);
          if (
            parsed &&
            typeof parsed.title === "string" &&
            typeof parsed.encoded === "string"
          ) {
            documents[parsed.title] = parsed;
            continue;
          }
        } catch {
          // Not JSON — fall through to raw format
        }
        // Raw format: key suffix is the title, value is the encoded menu data
        const title = key.slice(5);
        const document: RelationshipMenuDocument = {
          title,
          encoded: value,
        };
        documents[title] = document;
      }
    }
  }
  return documents;
};

const localStorageSaveDocuments = async (
  ...docs: RelationshipMenuDocument[]
): Promise<string[]> => {
  console.log("Saving documents to localStorage...");
  const ids: string[] = [];
  for (const doc of docs) {
    const key = `menu:${doc.title}`;
    localStorage.setItem(key, doc.encoded);
    ids.push(doc.title);
  }
  return ids;
};

export const localStorageDeleteDocument = async (title: string) => {
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i);
    if (key && key.startsWith("menu:")) {
      const value = localStorage.getItem(key);
      if (value !== null) {
        // Try JSON format first (IPFS entries use CID-based keys with JSON values)
        let isJsonMenu = false;
        try {
          const parsed = JSON.parse(value);
          if (
            parsed &&
            typeof parsed.title === "string" &&
            typeof parsed.encoded === "string"
          ) {
            isJsonMenu = true;
            if (parsed.title === title) {
              localStorage.removeItem(key);
              continue;
            }
          }
        } catch {
          // Not JSON — fall through to raw format
        }
        // Raw format: only when value is not a valid JSON menu document
        if (!isJsonMenu && key === `menu:${title}`) {
          localStorage.removeItem(key);
        }
      }
    }
  }
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
