import { IDBFactory } from "fake-indexeddb";
import { IPFS_BLOCK_DB, base32Decode, base32Encode, blockLocation, ipfsPointerCid, recoverIpfsMenus } from "./ipfs-recovery";
import { createLocalStorage } from "./storage";

/**
 * Test vectors computed with the real multiformats 13.4.2 library (the one the IPFS
 * version used): CID.createV1(json.code, sha256(json.encode(doc))) and Helia's
 * IDBBlockstore key, "/" + base32upper.encoder.encode(cid.multihash.bytes).
 */
const VECTORS = [
  {
    doc: { title: "Our menu", encoded: "eJyrVkrOT0lVslJKzEvMTVWqBQApRQUN" },
    cid: "bagaaierabjnwk4wjmkdx6lzwmn33rbhqbithdrj6sqd3kvdhm62lrpjum4kq",
    key: "/BCIQAUW3FOLEWFB37F43GG55YQTYAUJTRYU7JIB5VKRTWPNFYXU2GOFI",
  },
  {
    doc: { title: 'Ünïcödé ❤️ & "quotes"', encoded: "abc" },
    cid: "bagaaierak33qlppz6fnehv63fsjmoq3nt5s5k5wunnjzkp2av3m6lfszeznq",
    key: "/BCIQFN5YFXX47CWSD27NSZEWHINWZ6ZOVO3KGWU4VH5AK5WPFSZMSMWY",
  },
];

const bytesOf = (doc: object) => new TextEncoder().encode(JSON.stringify(doc));
const DATE = "2025-03-14T09:26:53.589Z";

/** Creates Helia's block store as the IPFS version did, holding `blocks`. */
const seedBlockStore = (idb: IDBFactory, blocks: { key: string; bytes: Uint8Array }[]) =>
  new Promise<void>((resolve, reject) => {
    const open = idb.open(IPFS_BLOCK_DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(IPFS_BLOCK_DB);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction(IPFS_BLOCK_DB, "readwrite");
      for (const block of blocks) tx.objectStore(IPFS_BLOCK_DB).put(block.bytes, block.key);
      tx.oncomplete = () => {
        open.result.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
  });

const blockCount = (idb: IDBFactory) =>
  new Promise<number>((resolve) => {
    const open = idb.open(IPFS_BLOCK_DB);
    open.onsuccess = () => {
      const request = open.result.transaction(IPFS_BLOCK_DB).objectStore(IPFS_BLOCK_DB).count();
      request.onsuccess = () => {
        open.result.close();
        resolve(request.result);
      };
    };
  });

let idb: IDBFactory;
beforeEach(() => {
  localStorage.clear();
  idb = new IDBFactory();
  vi.stubGlobal("indexedDB", idb);
});
afterEach(() => vi.unstubAllGlobals());

describe("SY-91: finding where the IPFS version kept a menu", () => {
  test.each(VECTORS)("maps $cid to Helia's block key", ({ doc, cid, key }) => {
    const location = blockLocation(cid);
    expect(location?.key).toBe(key);
  });

  test("the CID's digest is the SHA-256 of the JSON block", async () => {
    for (const { doc, cid } of VECTORS) {
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytesOf(doc)));
      expect(blockLocation(cid)?.digest).toEqual(digest);
    }
  });

  test("rejects CIDs of other kinds", () => {
    expect(blockLocation("bafyreigdmqpykrgxyaxtlafqpqhzrusn5nugbkjf3iy2grdiqbpnb2jcri")).toBeNull(); // dag-cbor
    expect(blockLocation("Qm123")).toBeNull();
    expect(blockLocation("b!!!")).toBeNull();
  });

  test("base32 round-trips", () => {
    const bytes = crypto.getRandomValues(new Uint8Array(37));
    expect(base32Decode(base32Encode(bytes))).toEqual(bytes);
  });

  test("recognises a pointer entry (a date under menu:<CID>), and nothing else", () => {
    const { cid } = VECTORS[0]!;
    expect(ipfsPointerCid(`menu:${cid}`, DATE)).toBe(cid);
    expect(ipfsPointerCid(`menu:${cid}`, JSON.stringify({ title: "x", encoded: "y" }))).toBeNull();
    expect(ipfsPointerCid("menu:Our menu", "eJyrVkrOT0lVslJKzEvMTVWqBQApRQUN")).toBeNull();
    expect(ipfsPointerCid(`other:${cid}`, DATE)).toBeNull();
  });
});

describe("SY-91: recovering IPFS-only menus", () => {
  test("lists a menu that only the IPFS block store had, dated when it was saved", async () => {
    const { doc, cid, key } = VECTORS[0]!;
    await seedBlockStore(idb, [{ key, bytes: bytesOf(doc) }]);
    localStorage.setItem(`menu:${cid}`, DATE);

    expect(await recoverIpfsMenus(idb)).toBe(1);
    expect(JSON.parse(localStorage.getItem(`menu:${cid}`)!)).toMatchObject({ ...doc, savedAt: Date.parse(DATE) });
    // Then it's listed like any other menu (and given an id, SY-90).
    const documents = Object.values(await createLocalStorage().getDocuments());
    expect(documents).toEqual([{ ...doc, id: expect.any(String) }]);
  });

  test("recovers several, including non-ASCII titles", async () => {
    await seedBlockStore(idb, VECTORS.map(({ doc, key }) => ({ key, bytes: bytesOf(doc) })));
    for (const { cid } of VECTORS) localStorage.setItem(`menu:${cid}`, DATE);
    expect(await recoverIpfsMenus(idb)).toBe(2);
    const documents = await createLocalStorage().getDocuments();
    expect(Object.values(documents).map((d) => d.title).sort()).toEqual(VECTORS.map((v) => v.doc.title).sort());
  });

  test("never lists a pointer it can't resolve as a menu (no unreadable entries)", async () => {
    await seedBlockStore(idb, []);
    localStorage.setItem(`menu:${VECTORS[0]!.cid}`, DATE);
    expect(await createLocalStorage().getDocuments()).toEqual({});
    // The pointer is kept, in case the data turns up.
    expect(localStorage.getItem(`menu:${VECTORS[0]!.cid}`)).toBe(DATE);
  });

  test("ignores a block that doesn't hash to its CID", async () => {
    const { cid, key } = VECTORS[0]!;
    await seedBlockStore(idb, [{ key, bytes: bytesOf({ title: "Tampered", encoded: "x" }) }]);
    localStorage.setItem(`menu:${cid}`, DATE);
    expect(await recoverIpfsMenus(idb)).toBe(0);
    expect(await createLocalStorage().getDocuments()).toEqual({});
  });

  test("doesn't create the old database when it was never there", async () => {
    localStorage.setItem(`menu:${VECTORS[0]!.cid}`, DATE);
    expect(await recoverIpfsMenus(idb)).toBe(0);
    expect((await idb.databases()).map((d) => d.name)).not.toContain(IPFS_BLOCK_DB);
  });

  test("doesn't touch IndexedDB at all when there are no pointers", async () => {
    localStorage.setItem("menu:Plain", JSON.stringify({ title: "Plain", encoded: "x", savedAt: 1 }));
    const open = vi.spyOn(idb, "open");
    expect(await recoverIpfsMenus(idb)).toBe(0);
    expect(open).not.toHaveBeenCalled();
  });

  test("goes on recovering the others when one menu can't be written (e.g. storage full)", async () => {
    await seedBlockStore(idb, VECTORS.map(({ doc, key }) => ({ key, bytes: bytesOf(doc) })));
    for (const { cid } of VECTORS) localStorage.setItem(`menu:${cid}`, DATE);
    const tooBig = `menu:${VECTORS[0]!.cid}`;
    const realSetItem = Storage.prototype.setItem;
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
      if (key === tooBig) throw new DOMException("full", "QuotaExceededError");
      return realSetItem.call(this, key, value);
    });
    expect(await recoverIpfsMenus(idb)).toBe(1);
    setItem.mockRestore();
    // The one that didn't fit keeps its pointer; the other was recovered.
    expect(localStorage.getItem(tooBig)).toBe(DATE);
    expect(JSON.parse(localStorage.getItem(`menu:${VECTORS[1]!.cid}`)!).title).toBe(VECTORS[1]!.doc.title);
  });

  test("is safe to run again: a recovered entry is no longer a pointer", async () => {
    const { doc, cid, key } = VECTORS[0]!;
    await seedBlockStore(idb, [{ key, bytes: bytesOf(doc) }]);
    localStorage.setItem(`menu:${cid}`, DATE);
    expect(await recoverIpfsMenus(idb)).toBe(1);
    expect(await recoverIpfsMenus(idb)).toBe(0);
  });

  test("SV-6: a newer copy with the same title still wins", async () => {
    const { doc, cid, key } = VECTORS[0]!;
    await seedBlockStore(idb, [{ key, bytes: bytesOf(doc) }]);
    localStorage.setItem(`menu:${cid}`, DATE);
    const newer = { title: doc.title, encoded: "newer", savedAt: Date.parse(DATE) + 1000 };
    localStorage.setItem(`menu:${doc.title}`, JSON.stringify(newer));
    const documents = Object.values(await createLocalStorage().getDocuments());
    expect(documents.filter((d) => d.title === doc.title).map((d) => d.encoded)).toEqual(["newer"]);
  });
});

describe("SY-92: the old IPFS data is left in place", () => {
  test("recovery reads the block store but doesn't change or delete it", async () => {
    await seedBlockStore(idb, VECTORS.map(({ doc, key }) => ({ key, bytes: bytesOf(doc) })));
    for (const { cid } of VECTORS) localStorage.setItem(`menu:${cid}`, DATE);
    await createLocalStorage().getDocuments();
    expect(await blockCount(idb)).toBe(2);
  });
});
