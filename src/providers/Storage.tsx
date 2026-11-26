import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Storage, createLocalStorage } from "../storage";
import { RelationshipMenuDocument } from "../model/menu";

export type SavedDocument = RelationshipMenuDocument & { id: string };

type StorageContextType = {
  storage: Storage;
  /** Every saved menu, by menu id (SY-20). Kept in step with saves, deletes, sync and other tabs. */
  documents: { [id: string]: SavedDocument };
  /** Deletes the menu with this id. */
  deleteDocument: (id: string) => Promise<void>;
};

const StorageContext = createContext<StorageContextType | undefined>(undefined);

const copy = <T,>(from: { [id: string]: T }): { [id: string]: T } => Object.assign(Object.create(null), from);

/**
 * Gives the app its menu storage (localStorage unless a `storage` is passed, e.g. in
 * tests) and the list of saved menus, updated as menus are saved and deleted here,
 * changed by sync, or changed in another tab.
 */
export const StorageProvider: React.FC<{
  children: React.ReactNode;
  storage?: Storage;
}> = ({ children, storage: given }) => {
  const [base] = useState<Storage>(() => given ?? createLocalStorage());
  const [documents, setDocuments] = useState<StorageContextType["documents"]>({});

  useEffect(() => {
    let current = true;
    const reload = () =>
      base.getDocuments().then((docs) => {
        if (current) setDocuments(docs);
      });
    void reload();
    const off = base.subscribe(() => void reload());
    return () => {
      current = false;
      off();
    };
  }, [base]);

  const storage: Storage = useMemo(
    () => ({
      getDocuments: base.getDocuments,
      subscribe: base.subscribe,
      saveDocuments: async (...docs) => {
        try {
          const ids = await base.saveDocuments(...docs);
          // Re-read what was saved, with its revision (SY-24).
          const saved = await Promise.all(ids.map((id) => base.getDocuments(id)));
          setDocuments((prev) => {
            const next = copy(prev);
            for (const one of saved) Object.assign(next, one);
            return next;
          });
          return ids;
        } catch (e) {
          console.error("Error saving documents:", e);
          return [];
        }
      },
      saveMenu: async (doc, startedFrom) => {
        const revision = await base.saveMenu(doc, startedFrom);
        const { revision: _old, ...stored } = doc;
        setDocuments((prev) => {
          const next = copy(prev);
          next[doc.id] = revision === null ? stored : { ...stored, revision };
          return next;
        });
        return revision;
      },
      deleteDocument: async (id: string) => {
        await base.deleteDocument(id);
        setDocuments((prev) => {
          const next = copy(prev);
          delete next[id];
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
