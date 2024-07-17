import { json } from "@helia/json";
import { createHelia } from "helia";
import { CID } from "multiformats/cid";
import { code, encode } from "multiformats/codecs/json";
import { sha256 } from "multiformats/hashes/sha2";
import { Storage } from "./storage";

export const calculateIpfsHash = async (obj: any): Promise<string> => {
  const bytes = encode(obj);
  const hash = await sha256.digest(bytes);
  const cid = CID.create(1, code, hash);
  return cid.toString();
}

// Implementation of the `Storage` type that uses @helia/json and IPFS:
export const createIpfsStorage = async (): Promise<Storage> => {
  const hel = await createHelia();
  const helJson = json(hel);

  return {
    getDocuments: async (id?: string) => {
      if (!id) {
        throw new Error("Empty ID not supported with IPFS storage");
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
      return ids;
    },
    clear: async () => {
      throw new Error("Clear not supported with IPFS storage");
    },
  };
};
