import { debounce } from "lodash";
import { RelationshipMenuDocument } from "./model/menu";

export type Storage = {
  getDocuments(
    id?: string
  ): Promise<{ [id: string]: RelationshipMenuDocument }>;
  saveDocuments(...docs: RelationshipMenuDocument[]): Promise<string[]>;
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

export const createLocalStorage = (): Storage => {
  return {
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
