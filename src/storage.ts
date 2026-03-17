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
    // saveDocuments: (...docs) =>
    //   new Promise((resolve) =>
    //     debounce(() => resolve(localStorageSaveDocuments(...docs)), 5000, {
    //       leading: true,
    //     })
    //   ),
    clear: localStorageClear,
  };
};
