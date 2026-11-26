import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
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
  // Counts saves and deletions made here, so a list read before one finished isn't shown.
  const mutations = useRef(0);

  useEffect(() => {
    let current = true;
    const reload = (): Promise<void> => {
      const startedAt = mutations.current;
      return base.getDocuments().then((docs) => {
        if (!current) return;
        // A save or deletion here finished while this was reading: read again, so the
        // list shows it (and whatever else changed).
        if (startedAt !== mutations.current) return reload();
        setDocuments(docs);
      });
    };
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
        let ids: string[];
        try {
          ids = await base.saveDocuments(...docs);
        } catch (e) {
          console.error("Error saving documents:", e);
          return [];
        }
        mutations.current++;
        // They're saved. Show them with their revisions (SY-24), read in one go; if that
        // read fails, show them as they were saved.
        let stored: { [id: string]: SavedDocument } | null = null;
        try {
          stored = await base.getDocuments();
        } catch {
          stored = null;
        }
        setDocuments((prev) => {
          const next = copy(prev);
          ids.forEach((id, i) => {
            const { revision: _revision, ...doc } = docs[i] ?? { title: "", encoded: "" };
            next[id] = stored?.[id] ?? { ...doc, id };
          });
          return next;
        });
        return ids;
      },
      saveMenu: async (doc, startedFrom) => {
        const revision = await base.saveMenu(doc, startedFrom);
        mutations.current++;
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
        mutations.current++;
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
