import { json, JSON } from "@helia/json";
import { createHelia } from "helia";
// NOTE: Importing from `multiformats` seems to break jest. This is a known issue with the library.
import { CID } from "multiformats/cid";
import { code, encode } from "multiformats/codecs/json";
import { sha256 } from "multiformats/hashes/sha2";
import { Storage } from "./storage";
import { RelationshipMenuDocument } from "./model/menu";
import { debounce } from "lodash";

/**
 * Calculates the IPFS hash for the given object.
 * @param obj - The object to calculate the IPFS hash for.
 * @returns A Promise that resolves to the IPFS hash as a string.
 */
export const calculateIpfsHash = async (obj: any): Promise<string> => {
  const bytes = encode(obj);
  const hash = await sha256.digest(bytes);
  const cid = CID.create(1, code, hash);
  return cid.toString();
};

const ipfsSaveDocuments =
  (helJson: JSON) =>
  async (...docs: RelationshipMenuDocument[]) => {
    console.log("Saving documents to IPFS...");
    const ids: string[] = [];
    for (const doc of docs) {
      const cid = await helJson.add(doc);
      ids.push(cid.toString());
    }
    // Add to localStorage:
    for (const id of ids) {
      localStorage.setItem(`menu:${id}`, new Date().toISOString());
      console.log(`Saved document with id: ${id}`);
    }
    return ids;
  };

const ipfsGetDocuments = (helJson: JSON) => async (id?: string) => {
  if (!id) {
    const promises = [] as Promise<[string, RelationshipMenuDocument]>[];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith("menu:")) {
        const id = key.slice(5);
        console.log(`Getting document with id: ${id}`);
        const cid = CID.parse(id);
        promises.push(
          // helJson.get<RelationshipMenuDocument>(cid).then((doc) => [id, doc])
          helJson.get<RelationshipMenuDocument>(cid).then((doc) => {
            console.log(`Got document with id: ${id}`, doc);
            return [id, doc]
          })
        );
      }
    }
    return Object.fromEntries(await Promise.all(promises));
  }
  const cid = CID.parse(id);
  return {
    [id]: await helJson.get<RelationshipMenuDocument>(cid),
  };
};

const ipfsClear = async () => {
  localStorage.clear();
};

// Implementation of the `Storage` type that uses @helia/json and IPFS:
/**
 * Creates an IPFS storage object.
 * @returns A promise that resolves to a Storage object.
 */
export const createIpfsStorage = async (): Promise<Storage> => {
  const hel = await createHelia();
  const helJson = json(hel);

  const getDocuments = ipfsGetDocuments(helJson);
  const saveDocuments = ipfsSaveDocuments(helJson);

  return {
    ready: () => true,
    getDocuments,
    // saveDocuments: (...docs) =>
    //   new Promise((resolve) =>
    //     debounce(() => resolve(saveDocuments(...docs)), 5000, {
    //       leading: true,
    //     })
    //   ),
    saveDocuments,
    clear: ipfsClear,
  };
};
