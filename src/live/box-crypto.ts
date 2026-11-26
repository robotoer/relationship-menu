/**
 * Live sharing, on the device (docs/spec/notifications.md §2, §3, §7a): box ids and
 * keys, the invite link, encrypting a conversation into a copy, and signing member
 * requests. The server only ever sees ciphertext, ids and public keys.
 */

import { deflate, inflate } from "pako";
import { type Bytes, ID_PATTERN, concat, fromBase64Url, fromUtf8, randomBytes, sha256, toBase64Url, utf8 } from "../sync/bytes";
import { requestPath } from "../sync/sign";
import { Conversation, parseConversation } from "../conversation";

export const BOX_PROTOCOL = "menu-box/v1";
export const PAD_BYTES = 4096;
export const NONCE_BYTES = 12;
/** Largest copy the server accepts (NT-5). */
export const MAX_COPY_BYTES = 256 * 1024;

/** A new box's id, key K and join secret J (NT-1). */
export const newBoxSecrets = () => ({
  boxId: toBase64Url(randomBytes(16)),
  key: randomBytes(32),
  join: randomBytes(32),
});

export type BoxSecrets = ReturnType<typeof newBoxSecrets>;

/** base64url(SHA-256(J)): what the server keeps to check joins. */
export const joinHash = async (join: Uint8Array) => toBase64Url(await sha256(join));

/** The invite link's fragment: `live=<boxId>.<K>.<J>` (NT-11). */
export const inviteFragment = (s: BoxSecrets) => `live=${s.boxId}.${toBase64Url(s.key)}.${toBase64Url(s.join)}`;

/** The invite in a link, a `#hash` or a bare fragment; null if it isn't one. */
export const parseInvite = (value: string): BoxSecrets | null => {
  const hash = value.includes("#") ? value.slice(value.indexOf("#") + 1) : value;
  const match = hash.match(/(?:^|&)live=([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})\.([A-Za-z0-9_-]{43})(?:&|$)/);
  if (!match) return null;
  const key = fromBase64Url(match[2]);
  const join = fromBase64Url(match[3]);
  if (!key || key.length !== 32 || !join || join.length !== 32) return null;
  return { boxId: match[1], key, join };
};

/** K as a WebCrypto key (AES-256-GCM). */
export const importBoxKey = (raw: Uint8Array) =>
  crypto.subtle.importKey("raw", new Uint8Array(raw), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);

/** This device's key pair for one box (NT-12). The private key can't be exported. */
export type DeviceKey = { keys: CryptoKeyPair; publicKey: Bytes; memberId: string };

export const memberIdFor = async (publicKey: Uint8Array) => toBase64Url((await sha256(publicKey)).slice(0, 16));

export const newDeviceKey = async (): Promise<DeviceKey> => {
  const generated = (await crypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"])) as CryptoKeyPair;
  const publicKey = new Uint8Array((await crypto.subtle.exportKey("raw", generated.publicKey)) as ArrayBuffer);
  return { keys: generated, publicKey, memberId: await memberIdFor(publicKey) };
};

/** The additional data bound into every copy (NT-2). */
export const copyAad = (boxId: string, memberId: string, version: number): Bytes => {
  if (!ID_PATTERN.test(boxId) || !ID_PATTERN.test(memberId) || !Number.isSafeInteger(version) || version < 1) {
    throw new Error("Bad box, member or version.");
  }
  return utf8(`${BOX_PROTOCOL}\n${boxId}\n${memberId}\n${version}`);
};

/** Length prefix, the bytes, then zeros to the next multiple of 4 KiB. */
export const padCopy = (plain: Uint8Array): Bytes => {
  const padded = new Uint8Array(Math.ceil((4 + plain.length) / PAD_BYTES) * PAD_BYTES);
  new DataView(padded.buffer).setUint32(0, plain.length);
  padded.set(plain, 4);
  return padded;
};

export const unpadCopy = (padded: Uint8Array): Bytes | null => {
  if (padded.length < 4 || padded.length % PAD_BYTES !== 0) return null;
  const length = new DataView(padded.buffer, padded.byteOffset, padded.byteLength).getUint32(0);
  if (4 + length > padded.length || padded.length !== Math.ceil((4 + length) / PAD_BYTES) * PAD_BYTES) return null;
  for (let i = 4 + length; i < padded.length; i++) if (padded[i] !== 0) return null;
  return padded.slice(4, 4 + length);
};

export class CopyTooLargeError extends Error {
  constructor() {
    super("This conversation is too large to share live.");
    this.name = "CopyTooLargeError";
  }
}

/** The conversation as one encrypted copy for `memberId` at `version` (NT-2). */
export const encryptCopy = async (
  key: CryptoKey,
  boxId: string,
  memberId: string,
  version: number,
  conversation: Conversation
): Promise<Bytes> => {
  const plain = padCopy(deflate(utf8(JSON.stringify(conversation))));
  const nonce = randomBytes(NONCE_BYTES);
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: copyAad(boxId, memberId, version) }, key, plain)
  );
  const out = concat(nonce, sealed);
  if (out.length > MAX_COPY_BYTES) throw new CopyTooLargeError();
  return out;
};

/**
 * A copy back as a conversation, cleaned like any untrusted input (CV-9); null if
 * it doesn't decrypt or isn't a conversation (NT-4).
 */
export const decryptCopy = async (
  key: CryptoKey,
  boxId: string,
  memberId: string,
  version: number,
  ciphertext: Uint8Array
): Promise<Conversation | null> => {
  try {
    if (ciphertext.length < NONCE_BYTES + 16) return null;
    const plain = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: new Uint8Array(ciphertext.slice(0, NONCE_BYTES)), additionalData: copyAad(boxId, memberId, version) },
        key,
        new Uint8Array(ciphertext.slice(NONCE_BYTES))
      )
    );
    const unpadded = unpadCopy(plain);
    if (!unpadded) return null;
    return parseConversation(JSON.parse(fromUtf8(inflate(unpadded))));
  } catch {
    return null;
  }
};

/** The five signed lines, like sync's (SY-6) with the box label. */
export const boxCanonicalRequest = (method: string, pathAndQuery: string, ts: number, bodyHash: string) =>
  [BOX_PROTOCOL, method.toUpperCase(), pathAndQuery, String(ts), bodyHash].join("\n");

/** `Authorization: MenuBox v1 box=…, key=…, ts=…, sig=…` for one request (§7a). */
export const memberAuthorization = async (
  boxId: string,
  device: Pick<DeviceKey, "keys" | "publicKey">,
  method: string,
  pathAndQuery: string,
  body: Uint8Array,
  ts: number
): Promise<string> => {
  const message = boxCanonicalRequest(method, requestPath(pathAndQuery), ts, toBase64Url(await sha256(body)));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, device.keys.privateKey, utf8(message)));
  return `MenuBox v1 box=${boxId}, key=${toBase64Url(device.publicKey)}, ts=${ts}, sig=${toBase64Url(sig)}`;
};
