/**
 * Keys from the sync code (SY-2).
 *
 *   secret (32 bytes: the 24 words)
 *     ├─ HKDF-SHA-256(salt "menu-sync/v1", info "sign", 32 bytes) → Ed25519 seed
 *     │     → signing key (PKCS#8 import) → public key (from its JWK "x")
 *     │     → accountId = base64url(first 16 bytes of SHA-256(public key))
 *     └─ HKDF-SHA-256(salt "menu-sync/v1", info "encrypt") → AES-256-GCM key
 *
 * FROZEN. The salt, both labels and every step above decide which account a
 * code opens and which key decrypts its menus. Changing any of them would lock
 * every supporter out of their synced menus, so test-vectors.ts pins the
 * results and those vectors must never change. The labels are deliberately
 * brand-neutral (§0, row 12).
 *
 * The keys this returns can't be exported: the code, the private key and the
 * encryption key never leave the device, and only the public key and the
 * account id are ever sent.
 */

import { type Bytes, concat, copyBytes, fromBase64Url, fromHex, sha256, toBase64Url, utf8 } from "./bytes";

export const KDF_SALT = "menu-sync/v1";
export const SIGN_INFO = "sign";
export const ENCRYPT_INFO = "encrypt";

const SECRET_BYTES = 32;

/**
 * The PKCS#8 wrapping of a raw Ed25519 private key (RFC 8410 §7): a fixed
 * 16-byte header, then the 32-byte seed. WebCrypto has no "raw" import for
 * Ed25519 private keys, so this is how a seed becomes a key.
 */
const ED25519_PKCS8_PREFIX = fromHex("302e020100300506032b657004220420");

export type SyncKeys = {
  /** Public: base64url, 22 characters (SY-2). */
  readonly accountId: string;
  /** Public: the raw 32-byte Ed25519 public key. */
  readonly publicKey: Bytes;
  /** Ed25519 private key, non-extractable, usage "sign". */
  readonly signingKey: CryptoKey;
  /** AES-256-GCM key, non-extractable, usages "encrypt" and "decrypt". */
  readonly encryptionKey: CryptoKey;
};

const hkdfParams = (salt: Uint8Array, info: Uint8Array): HkdfParams => ({
  name: "HKDF",
  hash: "SHA-256",
  salt: copyBytes(salt),
  info: copyBytes(info),
});

/** HKDF-SHA-256 (RFC 5869) through WebCrypto: `length` bytes of output keying material. */
export const hkdf = async (ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number): Promise<Bytes> => {
  const key = await crypto.subtle.importKey("raw", copyBytes(ikm), "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits(hkdfParams(salt, info), key, length * 8));
};

/** base64url(first 16 bytes of SHA-256(public key)), exactly as server/src/auth.ts accountIdForKey. */
export const accountIdForKey = async (publicKey: Uint8Array): Promise<string> =>
  toBase64Url((await sha256(publicKey)).slice(0, 16));

/**
 * Turns a 32-byte Ed25519 seed into a non-extractable signing key and its public
 * key. The public key is read from the JWK export of a short-lived extractable
 * copy, since WebCrypto can't compute it any other way.
 */
export const ed25519FromSeed = async (seed: Uint8Array): Promise<{ signingKey: CryptoKey; publicKey: Bytes }> => {
  if (seed.length !== 32) throw new Error("An Ed25519 seed is 32 bytes.");
  const pkcs8 = concat(ED25519_PKCS8_PREFIX, seed);
  try {
    const exportable = await crypto.subtle.importKey("pkcs8", pkcs8, { name: "Ed25519" }, true, ["sign"]);
    const { x } = await crypto.subtle.exportKey("jwk", exportable);
    const publicKey = x === undefined ? null : fromBase64Url(x);
    if (publicKey?.length !== 32) throw new Error("This browser didn't give an Ed25519 public key.");
    const signingKey = await crypto.subtle.importKey("pkcs8", pkcs8, { name: "Ed25519" }, false, ["sign"]);
    return { signingKey, publicKey };
  } finally {
    pkcs8.fill(0);
  }
};

/** Derives the account id and keys from a 32-byte sync secret (SY-2). */
export const deriveKeys = async (secret: Uint8Array): Promise<SyncKeys> => {
  if (secret.length !== SECRET_BYTES) throw new Error("A sync secret is 32 bytes.");
  const ikm = copyBytes(secret);
  const salt = utf8(KDF_SALT);
  try {
    const seed = await hkdf(ikm, salt, utf8(SIGN_INFO), 32);
    let signing: Awaited<ReturnType<typeof ed25519FromSeed>>;
    try {
      signing = await ed25519FromSeed(seed);
    } finally {
      seed.fill(0);
    }
    // deriveKey keeps the AES key's bytes out of JavaScript entirely. They're the
    // same 32 bytes hkdf(secret, salt, "encrypt", 32) returns (keys.test.ts checks).
    const base = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveKey"]);
    const encryptionKey = await crypto.subtle.deriveKey(
      hkdfParams(salt, utf8(ENCRYPT_INFO)),
      base,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
    return {
      accountId: await accountIdForKey(signing.publicKey),
      publicKey: signing.publicKey,
      signingKey: signing.signingKey,
      encryptionKey,
    };
  } finally {
    ikm.fill(0);
  }
};
