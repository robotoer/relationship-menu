import React, { createContext, useContext, useState, useEffect } from 'react';
import { Storage, createLocalStorage, createIpfsStorage } from '../storage';
import { RelationshipMenuDocument } from '../model/menu';

type StorageContextType = {
  storage: Storage;
  documents: { [id: string]: RelationshipMenuDocument };
  setStorageType: (type: 'local' | 'ipfs') => void;
};

const StorageContext = createContext<StorageContextType | undefined>(undefined);

export const StorageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [storage, setStorage] = useState<Storage>(createLocalStorage());
  const [documents, setDocuments] = useState<{ [id: string]: RelationshipMenuDocument }>({});

  useEffect(() => {
    const fetchDocuments = async () => {
      const docs = await storage.getDocuments();
      setDocuments(docs);
    };
    fetchDocuments();
  }, [storage]);

  const setStorageType = (type: 'local' | 'ipfs') => {
    if (type === 'local') {
      setStorage(createLocalStorage());
    } else if (type === 'ipfs') {
      setStorage(createIpfsStorage());
    }
  };

  return (
    <StorageContext.Provider value={{ storage, documents, setStorageType }}>
      {children}
    </StorageContext.Provider>
  );
};

export const useStorage = (): StorageContextType => {
  const context = useContext(StorageContext);
  if (!context) {
    throw new Error('useStorage must be used within a StorageProvider');
  }
  return context;
};
