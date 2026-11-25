import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Storage, createLocalStorage } from "../storage";
import { RelationshipMenuDocument } from "../model/menu";

type StorageContextType = {
  storage: Storage;
  /** Every saved menu, by title. Kept in step with saves and deletes. */
  documents: { [title: string]: RelationshipMenuDocument };
  deleteDocument: (title: string) => Promise<void>;
};

const StorageContext = createContext<StorageContextType | undefined>(undefined);

/**
 * Gives the app its menu storage (localStorage unless a `storage` is passed, e.g. in
 * tests) and the list of saved menus, updated as menus are saved and deleted.
 */
export const StorageProvider: React.FC<{
  children: React.ReactNode;
  storage?: Storage;
}> = ({ children, storage: given }) => {
  const [base] = useState<Storage>(() => given ?? createLocalStorage());
  const [documents, setDocuments] = useState<StorageContextType["documents"]>({});

  useEffect(() => {
    base.getDocuments().then(setDocuments);
  }, [base]);

  const storage: Storage = useMemo(
    () => ({
      getDocuments: base.getDocuments,
      saveDocuments: async (...docs) => {
        try {
          const ids = await base.saveDocuments(...docs);
          setDocuments((prev) => {
            // No prototype: titles are user text (e.g. "__proto__").
            const next: typeof prev = Object.assign(Object.create(null), prev);
            for (const doc of docs) next[doc.title] = doc;
            return next;
          });
          return ids;
        } catch (e) {
          console.error("Error saving documents:", e);
          return [];
        }
      },
      deleteDocument: async (title: string) => {
        await base.deleteDocument(title);
        setDocuments((prev) => {
          const next: typeof prev = Object.assign(Object.create(null), prev);
          delete next[title];
          return next;
        });
      },
    }),
    [base]
  );

  return (
    <StorageContext.Provider value={{ storage, documents, deleteDocument: storage.deleteDocument }}>
      {children}
    </StorageContext.Provider>
  );
};

export const useStorage = (): StorageContextType => {
  const context = useContext(StorageContext);
  if (!context) {
    throw new Error("useStorage must be used within a StorageProvider");
  }
  return context;
};
