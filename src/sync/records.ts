/**
 * Encrypted menu records (SY-15, SY-16, SY-19). The server stores these bytes
 * and never anything else about a menu.
 *
 * Record (what PUT and DELETE /v1/menus/:id send, and pulls return):
 *
 *   nonce (12 random bytes) ‖ AES-256-GCM(padded plaintext) with its 16-byte tag
 *
 * so a record is always 28 bytes longer than its padded plaintext.
 *
 * Additional data (authenticated, not sent), 65 bytes:
 *
 *   offset  size  field
 *        0    12  "menu-sync/v1" (ASCII)
 *       12    22  account id (ASCII, base64url)
 *       34    22  menu id (ASCII, base64url)
 *       56     8  version, unsigned big-endian
 *       64     1  0x01 if this is a tombstone, else 0x00
 *
 * So the server can't move a record to another account or menu, pass an old
 * record off as a newer version, or turn a menu into a deletion (or back),
 * without decryption failing. `version` is the version the server gives this
 * write: 1 for a new menu (If-None-Match: *), otherwise the If-Match version + 1.
 *
 * Padded plaintext: a 4-byte unsigned big-endian length n, then n bytes of
 * UTF-8 JSON, then zeros up to the next multiple of 1024 bytes (the fewest that
 * fit; at least 1024). The JSON is
 *
 *   { "v": 1, "id", "title", "encoded", "person"?, "createdAt"?, "updatedAt"?, "editId", "deleted"? }
 *
 * The padding hides how many items a menu has, to the nearest KiB (SY-16).
 * A tombstone is the same, with "deleted": true and an empty title and menu.
 */

import type { Person } from "../model/menu";
import { type Bytes, ID_PATTERN, concat, fromBase64Url, fromUtf8, randomBytes, utf8 } from "./bytes";
import type { SyncKeys } from "./keys";
import { PROTOCOL } from "./sign";

export const RECORD_FORMAT = 1;
export const PAD_BLOCK_BYTES = 1024;
export const NONCE_BYTES = 12;
export const TAG_BYTES = 16;
/** Nonce + tag. */
export const RECORD_OVERHEAD_BYTES = NONCE_BYTES + TAG_BYTES;

/** The server's limits (server/src/env.ts LIMITS): 64 KiB per menu, 4 KiB per tombstone. */
const SERVER_MENU_BYTES = 64 * 1024;
const SERVER_TOMBSTONE_BYTES = 4 * 1024;
const fit = (limit: number) => Math.floor((limit - RECORD_OVERHEAD_BYTES) / PAD_BLOCK_BYTES) * PAD_BLOCK_BYTES;
/** The largest padded plaintext the server will take: 63 KiB for a menu, 3 KiB for a tombstone. */
export const MAX_PADDED_BYTES = fit(SERVER_MENU_BYTES);
export const MAX_TOMBSTONE_PADDED_BYTES = fit(SERVER_TOMBSTONE_BYTES);

const AAD_BYTES = 65;
const MAX_VERSION = Number.MAX_SAFE_INTEGER;

/** One menu as it travels between devices, inside the encryption. */
export type MenuRecord = {
  /** The menu id (SY-20): 22 characters of base64url. */
  id: string;
  title: string;
  /** The menu itself, encoded as in links (data-encoder.ts). */
  encoded: string;
  person?: Person;
  createdAt?: number;
  updatedAt?: number;
  /** Identifies the edit that produced this record (SY-37). */
  editId: string;
  /** Set only on tombstones (SY-19). */
  deleted?: true;
};

/** A record as the server lists it: `GET /v1/menus` rows, with ciphertext as bytes or base64url. */
export type StoredRecord = {
  id: string;
  version: number;
  deleted: boolean;
  ciphertext: Uint8Array | string;
};

export type RecordProblem = "too_large" | "unreadable";

/**
 * "too_large": the menu doesn't fit in one record (64 KiB), so it can't sync.
 * "unreadable": the record failed to decrypt or isn't a valid record (SY-17).
 * Messages never contain any of the menu.
 */
export class SyncRecordError extends Error {
  constructor(readonly problem: RecordProblem, message: string) {
    super(message);
    this.name = "SyncRecordError";
  }
}

const unreadable = () => new SyncRecordError("unreadable", "This synced record couldn't be read.");

const checkId = (id: string, what: string) => {
  if (!ID_PATTERN.test(id)) throw new Error(`Expected a 22-character ${what} id.`);
};

const checkVersion = (version: number) => {
  if (!Number.isSafeInteger(version) || version < 1 || version > MAX_VERSION) {
    throw new Error("Expected a record version of 1 or more.");
  }
};

/** The 65 bytes of additional data described at the top of this file. */
export const recordAad = (accountId: string, menuId: string, version: number, deleted: boolean): Bytes => {
  checkId(accountId, "account");
  checkId(menuId, "menu");
  checkVersion(version);
  const aad = new Uint8Array(AAD_BYTES);
  aad.set(utf8(PROTOCOL), 0);
  aad.set(utf8(accountId), 12);
  aad.set(utf8(menuId), 34);
  const view = new DataView(aad.buffer);
  view.setUint32(56, Math.floor(version / 2 ** 32));
  view.setUint32(60, version >>> 0);
  aad[64] = deleted ? 1 : 0;
  return aad;
};

/** Length prefix, then the bytes, then zeros to the next multiple of 1 KiB. */
export const pad = (plain: Uint8Array): Bytes => {
  const padded = new Uint8Array(Math.ceil((4 + plain.length) / PAD_BLOCK_BYTES) * PAD_BLOCK_BYTES);
  new DataView(padded.buffer).setUint32(0, plain.length);
  padded.set(plain, 4);
  return padded;
};

/** The inverse of pad(). Returns null unless the padding is exactly what pad() writes. */
export const unpad = (padded: Uint8Array): Bytes | null => {
  if (padded.length < 4) return null;
  const length = new DataView(padded.buffer, padded.byteOffset, padded.byteLength).getUint32(0);
  if (padded.length !== Math.ceil((4 + length) / PAD_BLOCK_BYTES) * PAD_BLOCK_BYTES) return null;
  for (let i = 4 + length; i < padded.length; i++) if (padded[i] !== 0) return null;
  return padded.slice(4, 4 + length);
};

/** The plaintext JSON, with its fields in a fixed order. */
const toPlaintext = (record: MenuRecord) =>
  JSON.stringify({
    v: RECORD_FORMAT,
    id: record.id,
    title: record.title,
    encoded: record.encoded,
    person: record.person && { name: record.person.name, pronouns: record.person.pronouns, note: record.person.note },
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    editId: record.editId,
    deleted: record.deleted ? true : undefined,
  });

/** A tombstone for a deleted menu: it carries nothing of the menu but its id (SY-19). */
export const tombstone = (id: string, editId: string, updatedAt?: number): MenuRecord => ({
  id,
  title: "",
  encoded: "",
  ...(updatedAt === undefined ? {} : { updatedAt }),
  editId,
  deleted: true,
});

/**
 * Encrypts a menu, or a tombstone, as the record for `version` of `record.id`
 * in this account. Every call uses a fresh random nonce.
 */
export const encryptRecord = async (
  keys: Pick<SyncKeys, "accountId" | "encryptionKey">,
  version: number,
  record: MenuRecord
): Promise<Bytes> => {
  if (typeof record.editId !== "string" || record.editId === "") throw new Error("A record needs an edit id.");
  const deleted = record.deleted === true;
  const additionalData = recordAad(keys.accountId, record.id, version, deleted);
  const plain = utf8(toPlaintext(record));
  const padded = pad(plain);
  plain.fill(0);
  try {
    if (padded.length > (deleted ? MAX_TOMBSTONE_PADDED_BYTES : MAX_PADDED_BYTES)) {
      throw new SyncRecordError("too_large", "This menu is too big to sync.");
    }
    const nonce = randomBytes(NONCE_BYTES);
    const sealed = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce, additionalData, tagLength: TAG_BYTES * 8 },
      keys.encryptionKey,
      padded
    );
    return concat(nonce, new Uint8Array(sealed));
  } finally {
    padded.fill(0);
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const optionalNumber = (value: unknown) => value === undefined || (typeof value === "number" && Number.isFinite(value));

const readPerson = (value: unknown): Person | undefined | null => {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return null;
  const person: Person = {};
  for (const field of ["name", "pronouns", "note"] as const) {
    const text = value[field];
    if (text === undefined) continue;
    if (typeof text !== "string") return null;
    person[field] = text;
  }
  return person;
};

/** Checks the decrypted JSON and keeps only the fields a record has. */
const readPlaintext = (json: unknown, menuId: string, deleted: boolean): MenuRecord | null => {
  if (!isRecord(json) || json.v !== RECORD_FORMAT) return null;
  const { id, title, encoded, createdAt, updatedAt, editId } = json;
  if (id !== menuId || typeof title !== "string" || typeof encoded !== "string") return null;
  if (typeof editId !== "string" || editId === "") return null;
  if (!optionalNumber(createdAt) || !optionalNumber(updatedAt)) return null;
  if ((json.deleted === true) !== deleted || (json.deleted !== undefined && json.deleted !== true)) return null;
  const person = readPerson(json.person);
  if (person === null) return null;
  return {
    id,
    title,
    encoded,
    ...(person === undefined ? {} : { person }),
    ...(createdAt === undefined ? {} : { createdAt: createdAt as number }),
    ...(updatedAt === undefined ? {} : { updatedAt: updatedAt as number }),
    editId,
    ...(deleted ? { deleted: true as const } : {}),
  };
};

/**
 * Decrypts a record the server returned. The server's id, version and deleted
 * flag are checked through the additional data, so if it changed any of them,
 * or any byte of the ciphertext, this throws SyncRecordError("unreadable"),
 * and the caller skips the record (SY-17).
 */
export const decryptRecord = async (
  keys: Pick<SyncKeys, "accountId" | "encryptionKey">,
  stored: StoredRecord
): Promise<MenuRecord> => {
  const bytes = typeof stored.ciphertext === "string" ? fromBase64Url(stored.ciphertext) : stored.ciphertext;
  if (!bytes || bytes.length < RECORD_OVERHEAD_BYTES + PAD_BLOCK_BYTES) throw unreadable();
  if (!ID_PATTERN.test(stored.id) || !Number.isSafeInteger(stored.version) || stored.version < 1) throw unreadable();
  const additionalData = recordAad(keys.accountId, stored.id, stored.version, stored.deleted === true);
  let padded: Bytes;
  try {
    padded = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: bytes.slice(0, NONCE_BYTES), additionalData, tagLength: TAG_BYTES * 8 },
        keys.encryptionKey,
        bytes.slice(NONCE_BYTES)
      )
    );
  } catch {
    throw unreadable();
  }
  try {
    const plain = unpad(padded);
    if (!plain) throw unreadable();
    let json: unknown;
    try {
      json = JSON.parse(fromUtf8(plain));
    } catch {
      throw unreadable();
    } finally {
      plain.fill(0);
    }
    const record = readPlaintext(json, stored.id, stored.deleted === true);
    if (!record) throw unreadable();
    return record;
  } finally {
    padded.fill(0);
  }
};
