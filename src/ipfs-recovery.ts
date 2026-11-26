/**
 * Recovers menus that only the old IPFS version kept (spec SY-91, SY-92).
 *
 * From July 2024 to March 2026 the IPFS storage wrote the menu itself only to
 * Helia's IndexedDB block store ("helia-blocks"); browser storage held just a date
 * under `menu:<CID>`. IPFS is gone, so those menus would otherwise show up as
 * unreadable entries. This reads each such block with plain IndexedDB (no IPFS
 * code), checks that it hashes to its CID, and writes the menu into browser storage
 * under the same key, where it's listed like any other menu. The old database is
 * never created, changed or deleted here.
 */

export const IPFS_BLOCK_DB = "helia-blocks";

const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

/** RFC 4648 base32, no padding, lowercase in and out. Null if not valid base32. */
export const base32Decode = (text: string): Uint8Array | null => {
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of text) {
    const index = BASE32.indexOf(char);
    if (index < 0) return null;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
};

export const base32Encode = (bytes: Uint8Array): string => {
  let out = "";
  let bits = 0;
  let value = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
};

/**
 * The CID of an IPFS-era pointer entry: key `menu:<CID>` whose value is only the
 * date it was saved. Null for anything else (JSON copies, raw menus, other keys).
 */
export const ipfsPointerCid = (key: string, value: string | null): string | null => {
  const match = key.match(/^menu:(b[a-z2-7]{40,})$/);
  if (!match?.[1] || value === null) return null;
  return /^\d{4}-\d{2}-\d{2}T[\d:.]+Z?$/.test(value.trim()) ? match[1] : null;
};

/**
 * Where Helia's IndexedDB block store kept a JSON block (CIDv1, codec json 0x0200,
 * sha2-256): key "/B" + base32upper(multihash). Null for any other kind of CID.
 */
export const blockLocation = (cid: string): { key: string; digest: Uint8Array } | null => {
  const bytes = cid.startsWith("b") ? base32Decode(cid.slice(1)) : null;
  // version 1 · codec 0x0200 (varint 0x80 0x04) · sha2-256 (0x12) · 32 bytes (0x20)
  if (!bytes || bytes.length !== 37) return null;
  const header = [0x01, 0x80, 0x04, 0x12, 0x20];
  if (header.some((b, i) => bytes[i] !== b)) return null;
  const multihash = bytes.slice(3);
  return { key: `/B${base32Encode(multihash).toUpperCase()}`, digest: bytes.slice(5) };
};

/** Opens a database only if it already exists; never creates one. */
const openExisting = (idb: IDBFactory, name: string): Promise<IDBDatabase | null> =>
  new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = idb.open(name);
    } catch {
      resolve(null);
      return;
    }
    let created = false;
    request.onupgradeneeded = () => {
      // It didn't exist: abort, so the open fails and nothing is created.
      created = true;
      request.transaction?.abort();
    };
    request.onsuccess = () => {
      const db = request.result;
      if (created || !db.objectStoreNames.contains(name)) {
        db.close();
        resolve(null);
      } else {
        resolve(db);
      }
    };
    request.onerror = (event) => {
      event.preventDefault();
      resolve(null);
    };
    request.onblocked = () => resolve(null);
  });

const readBlock = (db: IDBDatabase, key: string): Promise<unknown> =>
  new Promise((resolve) => {
    try {
      const request = db.transaction(IPFS_BLOCK_DB, "readonly").objectStore(IPFS_BLOCK_DB).get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = (event) => {
        event.preventDefault();
        resolve(undefined);
      };
    } catch {
      resolve(undefined);
    }
  });

const asBytes = (value: unknown): Uint8Array | null => {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return null;
};

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((byte, i) => byte === b[i]);

/** The menu fields of a JSON block, or null if it isn't a menu document. */
const menuFromBlock = (bytes: Uint8Array): Record<string, unknown> | null => {
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!parsed || typeof parsed !== "object") return null;
    const { title, encoded, person, createdAt, updatedAt } = parsed as Record<string, unknown>;
    if (typeof title !== "string" || typeof encoded !== "string") return null;
    return { title, encoded, person, createdAt, updatedAt };
  } catch {
    return null;
  }
};

/**
 * Copies every IPFS-only menu it can find into browser storage, under its existing
 * `menu:<CID>` key, dated when the IPFS version saved it (so SV-6's "most recent
 * wins" still holds). Returns how many it recovered. Safe to run any number of
 * times: a recovered entry is JSON, so it's no longer a pointer.
 */
export const recoverIpfsMenus = async (
  idb: IDBFactory | undefined = globalThis.indexedDB
): Promise<number> => {
  const pointers: { key: string; value: string; cid: string }[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    const value = key === null ? null : localStorage.getItem(key);
    const cid = key === null ? null : ipfsPointerCid(key, value);
    if (key !== null && value !== null && cid) pointers.push({ key, value, cid });
  }
  if (pointers.length === 0 || !idb) return 0;

  const db = await openExisting(idb, IPFS_BLOCK_DB);
  if (!db) return 0;
  let recovered = 0;
  try {
    for (const pointer of pointers) {
      const location = blockLocation(pointer.cid);
      if (!location) continue;
      const bytes = asBytes(await readBlock(db, location.key));
      if (!bytes) continue;
      // Only trust a block that really is the one the pointer names.
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)));
      if (!sameBytes(digest, location.digest)) continue;
      const menu = menuFromBlock(bytes);
      if (!menu) continue;
      // Another tab may have saved meanwhile; never overwrite a changed entry.
      if (localStorage.getItem(pointer.key) !== pointer.value) continue;
      const savedAt = Date.parse(pointer.value);
      try {
        localStorage.setItem(
          pointer.key,
          JSON.stringify({ ...menu, savedAt: Number.isFinite(savedAt) ? savedAt : 0 })
        );
        recovered++;
      } catch {
        // E.g. this menu doesn't fit in what's left of the storage quota. Leave its
        // pointer as it is (a later load can try again) and go on with the others,
        // which may be smaller.
      }
    }
  } finally {
    db.close();
  }
  return recovered;
};
