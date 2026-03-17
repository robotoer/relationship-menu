import { json, JSON as HeliaJSON } from "@helia/json";
import { IDBBlockstore } from "blockstore-idb";
import { IDBDatastore } from "datastore-idb";
import { createHelia, Helia } from "helia";
// NOTE: Importing from `multiformats` seems to break jest. This is a known issue with the library.
import { CID } from "multiformats/cid";
import { code, encode } from "multiformats/codecs/json";
import { sha256 } from "multiformats/hashes/sha2";
import { Storage } from "./storage";
import { RelationshipMenuDocument } from "./model/menu";

// Global reference to the Helia instance for monitoring
let heliaInstance: Helia | null = null;

/**
 * Reset the Helia instance (useful for testing)
 */
export const resetHeliaInstance = async (): Promise<void> => {
  if (heliaInstance) {
    try {
      await heliaInstance.stop();
    } catch (error) {
      console.error('Error stopping Helia instance:', error);
    }
    heliaInstance = null;
  }
};

/**
 * Get the current Helia instance for monitoring and testing
 */
export const getHeliaInstance = (): Helia | null => heliaInstance;

/**
 * Get network statistics for the current node
 */
export const getNetworkStats = () => {
  if (!heliaInstance) {
    return {
      peerId: null,
      connections: 0,
      peers: [],
      multiaddrs: [],
    };
  }
  
  // Type assertion needed because Helia's types don't expose libp2p
  const libp2p = (heliaInstance as any).libp2p;
  if (!libp2p) {
    return {
      peerId: null,
      connections: 0,
      peers: [],
      multiaddrs: [],
    };
  }
  
  const connections = libp2p.getConnections();
  const peers = connections.map((conn: any) => conn.remotePeer.toString());
  const multiaddrs = libp2p.getMultiaddrs().map((ma: any) => ma.toString());
  
  return {
    peerId: libp2p.peerId.toString(),
    connections: connections.length,
    peers: Array.from(new Set(peers)), // Remove duplicates
    multiaddrs,
  };
};

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
  (helJson: HeliaJSON) =>
  async (...docs: RelationshipMenuDocument[]) => {
    console.log("Saving documents to IPFS...");
    const ids: string[] = [];
    for (const doc of docs) {
      const cid = await helJson.add(doc);
      ids.push(cid.toString());
      
      // Add to localStorage with document JSON as a fallback in case IndexedDB is cleared
      localStorage.setItem(`menu:${cid.toString()}`, JSON.stringify(doc));
      console.log(`Saved document with id: ${cid.toString()}`);
    }
    return ids;
  };

const ipfsGetDocuments = (helJson: HeliaJSON) => async (id?: string) => {
  if (!id) {
    const promises: Promise<[string, RelationshipMenuDocument] | null>[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith("menu:")) {
        const id = key.slice(5);
        console.log(`Getting document with id: ${id}`);
        try {
          const cid = CID.parse(id);
          promises.push(
            helJson.get<RelationshipMenuDocument>(cid)
              .then((doc): [string, RelationshipMenuDocument] => {
                console.log(`Got document with id: ${id}`, doc);
                return [id, doc];
              })
              .catch((error) => {
                console.error(`Failed to get document with id: ${id}`, error);
                // Fall back to localStorage JSON if Helia fetch fails
                const rawValue = localStorage.getItem(`menu:${id}`);
                if (rawValue) {
                  try {
                    const doc = JSON.parse(rawValue);
                    if (doc && doc.title && doc.encoded) {
                      return [id, doc] as [string, RelationshipMenuDocument];
                    }
                  } catch { /* not JSON, old timestamp format */ }
                }
                return null;
              })
          );
        } catch (e) {
          console.error(`Invalid CID: ${id}`, e);
        }
      }
    }
    
    const results = await Promise.all(promises);
    // Filter out null results
    const validResults = results.filter((r): r is [string, RelationshipMenuDocument] => r !== null);
    // Deduplicate by title — multiple CIDs may point to different versions
    // of the same menu. Keep the last one (most recently saved).
    const byTitle: { [title: string]: RelationshipMenuDocument } = {};
    for (const [, doc] of validResults) {
      byTitle[doc.title] = doc;
    }
    return byTitle;
  }
  
  try {
    const cid = CID.parse(id);
    console.log(`Attempting to fetch document with id ${id} from IPFS network`);
    
    // This will attempt to fetch from the P2P network
    const doc = await helJson.get<RelationshipMenuDocument>(cid);
    
    // If we successfully fetched it from the network, store it locally as JSON fallback
    if (doc) {
      localStorage.setItem(`menu:${id}`, JSON.stringify(doc));
      console.log(`Retrieved and stored document with id: ${id} from network`);
    }

    return {
      [id]: doc,
    };
  } catch (error) {
    console.error(`Failed to get document with id: ${id} from network`, error);
    // Fall back to localStorage JSON if Helia fetch fails
    const rawValue = localStorage.getItem(`menu:${id}`);
    if (rawValue) {
      try {
        const doc = JSON.parse(rawValue);
        if (doc && doc.title && doc.encoded) {
          return { [id]: doc };
        }
      } catch { /* not JSON, old timestamp format */ }
    }
    return {};
  }
};

const ipfsClear = async () => {
  localStorage.clear();
};

/**
 * Creates an IPFS storage object with P2P connectivity.
 * Helia's default configuration includes WebRTC, WebSockets, and bootstrap nodes
 * for peer-to-peer connectivity.
 * @returns A promise that resolves to a Storage object.
 */
export const createIpfsStorage = async (): Promise<Storage> => {
  // Create Helia with default P2P configuration
  // By default, Helia includes:
  // - WebRTC and WebSockets transports
  // - Bootstrap peer discovery
  // - DHT for content routing
  // - Circuit relay for NAT traversal
  const blockstore = new IDBBlockstore('helia-blocks');
  const datastore = new IDBDatastore('helia-data');

  await blockstore.open();
  await datastore.open();

  const helia = await createHelia({ blockstore, datastore });
  
  heliaInstance = helia;
  
  // Type assertion needed because Helia's types don't expose libp2p
  const libp2p = (helia as any).libp2p;
  
  console.log('🚀 IPFS node started');
  console.log('📍 Peer ID:', libp2p.peerId.toString());
  console.log('🔗 Listening on:', libp2p.getMultiaddrs().map((ma: any) => ma.toString()));
  
  // Log peer discovery events
  libp2p.addEventListener('peer:discovery', (evt: any) => {
    console.log('🔍 Discovered peer:', evt.detail.id.toString());
  });
  
  // Log peer connection events
  libp2p.addEventListener('peer:connect', (evt: any) => {
    console.log('✅ Connected to peer:', evt.detail.toString());
    console.log('📊 Total connections:', libp2p.getConnections().length);
  });
  
  // Log peer disconnection events
  libp2p.addEventListener('peer:disconnect', (evt: any) => {
    console.log('❌ Disconnected from peer:', evt.detail.toString());
    console.log('📊 Total connections:', libp2p.getConnections().length);
  });
  
  const helJson = json(helia);

  const getDocuments = ipfsGetDocuments(helJson);
  const saveDocuments = ipfsSaveDocuments(helJson);

  // Expose network stats to window for E2E testing
  if (typeof window !== 'undefined') {
    (window as any).__getNetworkStats = getNetworkStats;
  }

  return {
    ready: () => true,
    getDocuments,
    saveDocuments,
    clear: ipfsClear,
  };
};
