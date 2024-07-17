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

export const StorageProvider: React.FC<{
  children: React.ReactNode;
  storage: Storage;
}> = ({ children, storage }) => {
  const [documents, setDocuments] = useState<{
    [id: string]: RelationshipMenuDocument;
  }>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | undefined>();

  useEffect(() => {
    const fetchDocuments = async () => {
      const docs = await storage.getDocuments();
      setDocuments(docs);
    };
    fetchDocuments();
  }, [storage]);

  // Record the state of saving/saveError in the context:
  const wrappedStorage: Storage = useMemo(
    () => ({
      getDocuments: storage.getDocuments,
      saveDocuments: async (...docs) => {
        setSaving(true);
        setSaveError(undefined);
        try {
          const ids = await storage.saveDocuments(...docs);
          setDocuments((prev) => {
            const next = { ...prev };
            for (const doc of docs) {
              next[doc.title] = doc;
            }
            return next;
          });
          return ids;
        } catch (e: any) {
          setSaveError(e.message);
          return [];
        } finally {
          setSaving(false);
        }
      },
      clear: storage.clear,
    }),
    [storage]
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
