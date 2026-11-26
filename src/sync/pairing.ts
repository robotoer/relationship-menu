/**
 * One-time pairing links (SY-10, SY-11), matching server/src/pairing.ts.
 *
 * The device that has the code picks a random 32-byte key K and uploads
 *
 *   POST /v1/pair  { id: base64url(first 16 bytes of SHA-256(K)), blob }
 *   blob = nonce (12 random bytes) ‖ AES-256-GCM_K(the 32-byte secret), additional data "menu-sync/v1\npair"
 *
 * (60 bytes; the server allows 1 KiB). It shows a QR code for /pair#<K in base64url>.
 * K lives only in the link's fragment, which browsers never send to a server,
 * so the server holds the encrypted code but never the key to it. The new
 * device reads the fragment, removes it from the address bar at once (SY-11),
 * fetches GET /v1/pair/<id> (the server returns the blob once, then deletes it)
 * and decrypts the secret.
 */

import { type Bytes, concat, copyBytes, fromBase64Url, randomBytes, sha256, toBase64Url, utf8 } from "./bytes";
import { PROTOCOL } from "./sign";

export const PAIRING_KEY_BYTES = 32;
export const PAIRING_PATH = "/pair";

const SECRET_BYTES = 32;
const NONCE_BYTES = 12;
const BLOB_BYTES = NONCE_BYTES + SECRET_BYTES + 16;
const PAIRING_AAD = `${PROTOCOL}\npair`;

/** What the first device needs: `id` and `blob` go to POST /v1/pair, `key` only into the link. */
export type Pairing = {
  /** base64url, 22 characters. */
  id: string;
  /** K in base64url, 43 characters. Secret: it goes in the link's fragment and nowhere else. */
  key: string;
  /** The encrypted secret in base64url, as POST /v1/pair takes it. */
  blob: string;
};

/** A pairing link that's malformed, or a blob that doesn't open with its key. */
export class PairingError extends Error {
  constructor(message = "This pairing link doesn't work. Type the 24 words instead.") {
    super(message);
    this.name = "PairingError";
  }
}

/** base64url(first 16 bytes of SHA-256(K)): the id the server stores the blob under. */
export const pairingIdForKey = async (key: Uint8Array): Promise<string> => {
  if (key.length !== PAIRING_KEY_BYTES) throw new PairingError();
  return toBase64Url((await sha256(key)).slice(0, 16));
};

const importPairingKey = (key: Uint8Array, usage: "encrypt" | "decrypt") =>
  crypto.subtle.importKey("raw", copyBytes(key), { name: "AES-GCM" }, false, [usage]);

/** Encrypts the sync secret under a new one-time key. */
export const createPairing = async (secret: Uint8Array): Promise<Pairing> => {
  if (secret.length !== SECRET_BYTES) throw new Error("A sync secret is 32 bytes.");
  const k = randomBytes(PAIRING_KEY_BYTES);
  try {
    const nonce = randomBytes(NONCE_BYTES);
    const sealed = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce, additionalData: utf8(PAIRING_AAD) },
      await importPairingKey(k, "encrypt"),
      copyBytes(secret)
    );
    return { id: await pairingIdForKey(k), key: toBase64Url(k), blob: toBase64Url(concat(nonce, new Uint8Array(sealed))) };
  } finally {
    k.fill(0);
  }
};

/** The link the QR code holds: `<origin>/pair#<key>`. */
export const pairingLink = (origin: string, key: string): string => `${new URL(origin).origin}${PAIRING_PATH}#${key}`;

/**
 * The key K from a pairing link's fragment (`location.hash`, with or without
 * the "#"), or null if it isn't one.
 */
export const pairingKeyFromFragment = (fragment: string): Bytes | null => {
  const text = fragment.startsWith("#") ? fragment.slice(1) : fragment;
  if (!/^[A-Za-z0-9_-]{43}$/.test(text)) return null;
  const key = fromBase64Url(text);
  // Only the canonical spelling: 43 characters carry 258 bits, the last 2 must be zero.
  return key?.length === PAIRING_KEY_BYTES && toBase64Url(key) === text ? key : null;
};

/** Decrypts the secret from the blob GET /v1/pair/:id returned. Throws PairingError if it doesn't open. */
export const openPairing = async (key: Uint8Array, blob: string | Uint8Array): Promise<Bytes> => {
  const bytes = typeof blob === "string" ? fromBase64Url(blob) : blob;
  if (key.length !== PAIRING_KEY_BYTES || bytes?.length !== BLOB_BYTES) throw new PairingError();
  try {
    const secret = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytes.slice(0, NONCE_BYTES), additionalData: utf8(PAIRING_AAD) },
      await importPairingKey(key, "decrypt"),
      bytes.slice(NONCE_BYTES)
    );
    return new Uint8Array(secret);
  } catch {
    throw new PairingError();
  }
};
