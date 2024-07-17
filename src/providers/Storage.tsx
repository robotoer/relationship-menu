import React, { createContext, useContext, useState, useEffect } from "react";
import { Storage } from "../storage";
import { RelationshipMenuDocument } from "../model/menu";

type StorageContextType = {
  storage: Storage;
  documents: { [id: string]: RelationshipMenuDocument };
};

const StorageContext = createContext<StorageContextType | undefined>(undefined);

export const StorageProvider: React.FC<{
  children: React.ReactNode;
  storage: Storage;
}> = ({ children, storage }) => {
  const [documents, setDocuments] = useState<{
    [id: string]: RelationshipMenuDocument;
  }>({});

  useEffect(() => {
    const fetchDocuments = async () => {
      const docs = await storage.getDocuments();
      setDocuments(docs);
    };
    fetchDocuments();
  }, [storage]);

  return (
    <StorageContext.Provider value={{ storage, documents }}>
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
