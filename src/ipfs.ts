import { json } from "@helia/json";
import { createHelia } from "helia";
import { CID } from "multiformats/cid";
import { code, encode } from "multiformats/codecs/json";
import { sha256 } from "multiformats/hashes/sha2";
import { Storage } from "./storage";
import { RelationshipMenuDocument } from "./model/menu";

export const calculateIpfsHash = async (obj: any): Promise<string> => {
  const bytes = encode(obj);
  const hash = await sha256.digest(bytes);
  const cid = CID.create(1, code, hash);
  return cid.toString();
};

// Implementation of the `Storage` type that uses @helia/json and IPFS:
export const createIpfsStorage = async (): Promise<Storage> => {
  const hel = await createHelia();
  const helJson = json(hel);

  return {
    getDocuments: async (id?: string) => {
      if (!id) {
        const promises = [] as Promise<[string, RelationshipMenuDocument]>[];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && key.startsWith("menu:")) {
            const id = key.slice(5);
            const cid = CID.parse(id);
            promises.push(
              helJson
                .get<RelationshipMenuDocument>(cid)
                .then((doc) => [id, doc])
            );
          }
        }
        return Object.fromEntries(await Promise.all(promises));
      }
      const cid = CID.parse(id);
      return {
        [id]: await helJson.get(cid),
      };
    },
    saveDocuments: async (...docs) => {
      const ids: string[] = [];
      for (const doc of docs) {
        const cid = await helJson.add(doc);
        ids.push(cid.toString());
      }
      // Add to localStorage:
      for (const id of ids) {
        localStorage.setItem(`menu:${id}`, new Date().toISOString());
      }
      return ids;
    },
    clear: async () => {
      localStorage.clear();
    },
  };
};
