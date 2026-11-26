/**
 * What this device keeps about each live conversation (NT-17): the box, its key,
 * this device's box key pair (the private half can't be exported), and how far it
 * has synced. Kept in IndexedDB, never in localStorage, a link or analytics.
 */

import type { Bytes } from "../sync/bytes";

export type LiveEntry = {
  conversationId: string;
  boxId: string;
  isHost: boolean;
  /** K, so the host can show the invite link again. */
  key: Bytes;
  /** J, host only, while the current invite lasts. */
  join?: Bytes;
  inviteExpiresAt?: number;
  device: { keys: CryptoKeyPair; publicKey: Bytes; memberId: string };
  /** This device's copy's version on the server, or null before the first write. */
  version: number | null;
  /** The box's change counter up to which copies have been read. */
  seq: number;
  /** Comment ids in the copy this device last wrote (to tell `Notify: comment`). */
  sentComments: string[];
  /** canonical() fingerprint of the conversation this device last wrote. */
  sentVersion?: string;
  /**
   * Fingerprint of the conversation after merging others' copies when this device
   * had nothing unsent: writing it only catches up, so it isn't news (NT-23).
   */
  receivedVersion?: string;
  /** This device's push subscription for this box, when "Notify me" is on (NT-20). */
  push?: { subId: string };
};

const DB = "wants-live";
const STORE = "boxes";

const open = (factory: IDBFactory): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = factory.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "conversationId" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const run = async <T>(factory: IDBFactory, mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>) => {
  const db = await open(factory);
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = work(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
};

export const createLiveStore = (factory: IDBFactory | undefined = globalThis.indexedDB) => {
  const available = () => {
    if (!factory) throw new Error("IndexedDB isn't available.");
    return factory;
  };
  return {
    get: async (conversationId: string): Promise<LiveEntry | null> => {
      if (!factory) return null;
      return ((await run(factory, "readonly", (s) => s.get(conversationId))) as LiveEntry | undefined) ?? null;
    },
    put: (entry: LiveEntry) => run(available(), "readwrite", (s) => s.put(entry)).then(() => undefined),
    delete: (conversationId: string) => run(available(), "readwrite", (s) => s.delete(conversationId)).then(() => undefined),
    all: async (): Promise<LiveEntry[]> => (factory ? ((await run(factory, "readonly", (s) => s.getAll())) as LiveEntry[]) : []),
  };
};

export type LiveStore = ReturnType<typeof createLiveStore>;

/** The conversation a box belongs to on this device, or null (for a tapped notification, NT-27). */
export const conversationForBox = async (store: LiveStore, boxId: string): Promise<string | null> =>
  (await store.all()).find((e) => e.boxId === boxId)?.conversationId ?? null;
