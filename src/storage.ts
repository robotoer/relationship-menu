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
export const createLocalStorage = (): Storage => {
  return {
    getDocuments: async (id?: string) => {
      const documents: { [id: string]: RelationshipMenuDocument } = {};
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith("menu:")) {
          const value = localStorage.getItem(key);
          if (value) {
            const title = key.slice(5);
            const document: RelationshipMenuDocument = {
              title,
              image: "https://via.placeholder.com/150",
              encoded: value,
            };
            documents[title] = document;
          }
        }
      }
      return documents;
    },
    saveDocuments: async (...docs) => {
      const ids: string[] = [];
      for (const doc of docs) {
        const key = `menu:${doc.title}`;
        localStorage.setItem(key, doc.encoded);
        ids.push(doc.title);
      }
      return ids;
    },
    clear: async () => {
      localStorage.clear();
    },
  };
};

// Implementation of the `Storage` type that uses @helia/json and IPFS:
export const createIpfsStorage = (): Storage => {
  return {
    getDocuments: async (id?: string) => {
      throw new Error("Not implemented");
    },
    saveDocuments: async (...docs) => {
      throw new Error("Not implemented");
    },
    clear: async () => {
      throw new Error("Not implemented");
    },
  };
};
