/**
 * Byte helpers for sync: UTF-8, base64url, hex, SHA-256 and random bytes.
 *
 * base64url here is the same as in server/src/bytes.ts (no padding), because the
 * app and the server have to agree on every byte (SY-6, SY-15).
 */

/** Bytes backed by a plain ArrayBuffer, which is what WebCrypto accepts. */
export type Bytes = Uint8Array<ArrayBuffer>;

const encoder = new TextEncoder();
const strictDecoder = new TextDecoder("utf-8", { fatal: true });

export const utf8 = (text: string): Bytes => encoder.encode(text);

/** Decodes UTF-8, throwing on invalid bytes instead of inserting U+FFFD. */
export const fromUtf8 = (bytes: Uint8Array): string => strictDecoder.decode(bytes);

export const toBase64Url = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

/** Decodes base64url (no padding). Returns null for anything that isn't valid. */
export const fromBase64Url = (text: string): Bytes | null => {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) return null;
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4);
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
};

export const toHex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

export const fromHex = (hex: string): Bytes => {
  if (!/^(?:[0-9a-fA-F]{2})*$/.test(hex)) throw new Error("Not a hex string");
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  return bytes;
};

export const concat = (...parts: Uint8Array[]): Bytes => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

/** Copies into a fresh ArrayBuffer-backed array (WebCrypto rejects some views). */
export const copyBytes = (bytes: Uint8Array): Bytes => new Uint8Array(bytes);

export const sha256 = async (data: Uint8Array): Promise<Bytes> =>
  new Uint8Array(await crypto.subtle.digest("SHA-256", copyBytes(data)));

export const randomBytes = (length: number): Bytes => crypto.getRandomValues(new Uint8Array(length));

/** A 128-bit id in base64url: 22 characters. Account, menu and pairing ids all use this (server/src/bytes.ts). */
export const ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
