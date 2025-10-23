import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useMemo,
} from "react";
import { Storage } from "../storage";
import { RelationshipMenuDocument } from "../model/menu";

type StorageContextType = {
  storage: Storage;
  documents: { [id: string]: RelationshipMenuDocument };

  saving: boolean;
  saveError?: string;
};

const StorageContext = createContext<StorageContextType | undefined>(undefined);

/**
 * A provider component that wraps the application and provides storage functionality.
 *
 * @component
 * @param {React.ReactNode} children - The child components to be wrapped by the provider.
 * @param {Storage} storage - The storage object used for storing documents.
 * @returns {React.ReactNode} The wrapped child components.
 */
export const StorageProvider: React.FC<{
  children: React.ReactNode;
  storage: Storage | Promise<Storage>;
}> = ({ children, storage }) => {
  const [documents, setDocuments] = useState<{
    [id: string]: RelationshipMenuDocument;
  }>({});
  const [awaitedStorage, setAwaitedStorage] = useState<Storage>({
    ready: () => false,
    getDocuments: async () => ({}),
    saveDocuments: async () => [],
    clear: async () => {},
  });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | undefined>();

  useEffect(() => {
    (async () => {
      setAwaitedStorage(await Promise.resolve(storage));
    })();
  }, [storage]);

  useEffect(() => {
    const fetchDocuments = async () => {
      const docs = await awaitedStorage?.getDocuments?.();
      if (docs) {
        setDocuments(docs);
      }
    };
    fetchDocuments();
  }, [awaitedStorage]);

  // Record the state of saving/saveError in the context:
  const wrappedStorage: Storage = useMemo(
    () => ({
      ready: awaitedStorage.ready,
      getDocuments: awaitedStorage.getDocuments,
      saveDocuments: async (...docs) => {
        console.log("wrappedStorage: saveDocuments");
        setSaving(true);
        console.log("wrappedStorage: setSaving(true)");
        setSaveError(undefined);
        console.log("wrappedStorage: setSaveError(undefined)");
        try {
          console.log("awaitedStorage:", awaitedStorage);
          const ids = await awaitedStorage.saveDocuments(...docs);
          console.log("wrappedStorage: saveDocuments");
          setDocuments((prev) => {
            const next = { ...prev };
            for (const doc of docs) {
              next[doc.title] = doc;
            }
            return next;
          });
          return ids;
        } catch (e: any) {
          console.error("Error saving documents:", e);
          setSaveError(e.message);
          return [];
        } finally {
          setSaving(false);
        }
      },
      clear: awaitedStorage.clear,
    }),
    [awaitedStorage]
  );

  return (
    <StorageContext.Provider
      value={{ storage: wrappedStorage, documents, saving, saveError }}
    >
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

export const useDocuments = (
  ...ids: string[]
): (RelationshipMenuDocument | undefined)[] => {
  const { storage, documents } = useStorage();
  const [doc, setDoc] = useState<(RelationshipMenuDocument | undefined)[]>([]);
  
  // Stabilize ids by deduplicating
  const stableIds = useMemo(() => {
    const unique = Array.from(new Set(ids));
    return unique;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(ids)]);
  
  useEffect(() => {
    (async () => {
      // Fetch all documents by calling getDocuments for each id
      const fetchPromises = stableIds.map(async (id) => {
        const fetchedDocs = await storage?.getDocuments?.(id);
        return fetchedDocs && fetchedDocs[id] ? fetchedDocs[id] : documents[id];
      });
      
      const results = await Promise.all(fetchPromises);
      setDoc(results);
    })();
  }, [documents, storage, stableIds]);
  
  return doc;
};
