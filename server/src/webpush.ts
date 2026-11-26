/**
 * Web Push from a Worker, with WebCrypto only (docs/spec/notifications.md NT-21,
 * NT-25, §7b):
 *
 * - RFC 8291 message encryption: ECDH P-256 with a fresh key pair per message,
 *   HKDF-SHA-256 for the input keying material, the content encryption key and
 *   the nonce, then one RFC 8188 `aes128gcm` record (rs = 4096, delimiter 0x02).
 * - RFC 8292 VAPID: an ES256 JWT for the endpoint's origin, valid 12 hours,
 *   `sub` = VAPID_SUBJECT, sent as `Authorization: vapid t=<jwt>, k=<public key>`.
 * - RFC 8030 delivery: TTL, Urgency and Topic headers.
 */

import { concat, fromBase64Url, toBase64Url, utf8 } from "./bytes";
import type { Env } from "./env";

/** RFC 8188 record size: a single record of at most this many bytes. */
export const RECORD_SIZE = 4096;
/** Push services keep an undelivered message this long (RFC 8030 TTL), in seconds. */
export const TTL_SECONDS = 86400;
/** How long a VAPID JWT is valid (RFC 8292 allows at most 24 hours), in seconds. */
export const JWT_LIFETIME_SECONDS = 12 * 3600;

const P256 = { name: "ECDH", namedCurve: "P-256" } as const;
const ES256 = { name: "ECDSA", namedCurve: "P-256" } as const;

/** What a browser's PushSubscription gives us (keys base64url). */
export type PushTarget = { endpoint: string; p256dh: string; auth: string };

/** The whole plaintext of a push (NT-25): no names, no text, no other ids. */
export type PushPayload = { box: string; kind: "comment" | "notes"; count: number };

export type VapidEnv = Env & { VAPID_PUBLIC_KEY: string; VAPID_PRIVATE_KEY: string; VAPID_SUBJECT: string };

/** Push is on only with a well-formed VAPID key pair and subject (§7b: otherwise 503). */
export const pushConfigured = (env: Env): env is VapidEnv => {
  const publicKey = env.VAPID_PUBLIC_KEY ? fromBase64Url(env.VAPID_PUBLIC_KEY) : null;
  const privateKey = env.VAPID_PRIVATE_KEY ? fromBase64Url(env.VAPID_PRIVATE_KEY) : null;
  return (
    publicKey?.length === 65 &&
    publicKey[0] === 0x04 &&
    privateKey?.length === 32 &&
    /^(mailto:|https:)/.test(env.VAPID_SUBJECT ?? "")
  );
};

const hkdf = async (salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number): Promise<Uint8Array> => {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bytes * 8));
};

/** ECDH P-256 shared secret (the runtime's parameter is `public`; the types call it `$public`). */
export const ecdh = async (privateKey: CryptoKey, publicRaw: Uint8Array): Promise<Uint8Array> => {
  const publicKey = await crypto.subtle.importKey("raw", publicRaw, P256, false, []);
  const algorithm = { name: "ECDH", public: publicKey } as unknown as SubtleCryptoDeriveKeyAlgorithm;
  return new Uint8Array(await crypto.subtle.deriveBits(algorithm, privateKey, 256));
};

/**
 * RFC 8291 §3.3–3.4: the content encryption key and nonce for one message, from
 * the ECDH secret, the receiver's auth secret, both public keys and the salt.
 * Exported so a test can play the browser and decrypt.
 */
export const deriveKeys = async (
  ecdhSecret: Uint8Array,
  authSecret: Uint8Array,
  uaPublic: Uint8Array,
  asPublic: Uint8Array,
  salt: Uint8Array
) => {
  const ikm = await hkdf(authSecret, ecdhSecret, concat(utf8("WebPush: info\0"), uaPublic, asPublic), 32);
  return {
    cek: await hkdf(salt, ikm, utf8("Content-Encoding: aes128gcm\0"), 16),
    nonce: await hkdf(salt, ikm, utf8("Content-Encoding: nonce\0"), 12),
  };
};

export type EncryptOptions = {
  /** Tests only: RFC 8291 Appendix A fixes the salt and the sender's key pair. */
  salt?: Uint8Array;
  ephemeral?: CryptoKeyPair;
};

/**
 * Encrypts `plaintext` to a browser's subscription keys (RFC 8291): the whole
 * `aes128gcm` body, salt ‖ rs ‖ idlen ‖ keyid (the sender's public key) ‖ record.
 */
export const encryptPayload = async (
  plaintext: Uint8Array,
  uaPublic: Uint8Array,
  authSecret: Uint8Array,
  options: EncryptOptions = {}
): Promise<Uint8Array> => {
  if (uaPublic.length !== 65 || uaPublic[0] !== 0x04 || authSecret.length !== 16) throw new Error("bad subscription keys");
  // One record: the plaintext, its delimiter and the 16-byte tag must fit in rs.
  if (plaintext.length + 1 + 16 > RECORD_SIZE) throw new Error("payload too large");
  const salt = options.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const ephemeral =
    options.ephemeral ?? ((await crypto.subtle.generateKey(P256, true, ["deriveBits"])) as CryptoKeyPair);
  const asPublic = new Uint8Array((await crypto.subtle.exportKey("raw", ephemeral.publicKey)) as ArrayBuffer);
  const { cek, nonce } = await deriveKeys(await ecdh(ephemeral.privateKey, uaPublic), authSecret, uaPublic, asPublic, salt);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  // The last (and only) record ends with the delimiter 0x02 and no padding (RFC 8188 §2).
  const record = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, concat(plaintext, new Uint8Array([0x02])))
  );
  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = asPublic.length;
  return concat(header, asPublic, record);
};

// ---- VAPID (RFC 8292) -----------------------------------------------------------

let signingKey: { secret: string; key: Promise<CryptoKey> } | null = null;

/** The VAPID private key as an ES256 signing key: d from the secret, x and y from the public key. */
const vapidSigningKey = (env: VapidEnv): Promise<CryptoKey> => {
  const secret = `${env.VAPID_PUBLIC_KEY}.${env.VAPID_PRIVATE_KEY}`;
  if (signingKey?.secret !== secret) {
    const publicKey = fromBase64Url(env.VAPID_PUBLIC_KEY)!;
    const jwk: JsonWebKey = {
      kty: "EC",
      crv: "P-256",
      x: toBase64Url(publicKey.slice(1, 33)),
      y: toBase64Url(publicKey.slice(33, 65)),
      d: env.VAPID_PRIVATE_KEY,
    };
    signingKey = { secret, key: crypto.subtle.importKey("jwk", jwk, ES256, false, ["sign"]) };
  }
  return signingKey.key;
};

const jsonPart = (value: unknown) => toBase64Url(utf8(JSON.stringify(value)));

/** An ES256 JWT for the push service at `endpoint` (RFC 8292 §2): aud = its origin. */
export const vapidJwt = async (env: VapidEnv, endpoint: string, nowMs = Date.now()): Promise<string> => {
  const unsigned = `${jsonPart({ typ: "JWT", alg: "ES256" })}.${jsonPart({
    aud: new URL(endpoint).origin,
    exp: Math.floor(nowMs / 1000) + JWT_LIFETIME_SECONDS,
    sub: env.VAPID_SUBJECT,
  })}`;
  // WebCrypto's ECDSA signature is r ‖ s (64 bytes), which is what JWS wants.
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, await vapidSigningKey(env), utf8(unsigned));
  return `${unsigned}.${toBase64Url(new Uint8Array(signature))}`;
};

/** `Authorization: vapid t=<jwt>, k=<public key>` (RFC 8292 §3). */
export const vapidAuthorization = async (env: VapidEnv, endpoint: string, nowMs = Date.now()) =>
  `vapid t=${await vapidJwt(env, endpoint, nowMs)}, k=${env.VAPID_PUBLIC_KEY}`;

// ---- Endpoints (NT-55) ------------------------------------------------------------

/** The push services the Worker will call; a host must be one of these or end in "." + one. */
export const PUSH_SERVICES = ["fcm.googleapis.com", "push.services.mozilla.com", "push.apple.com", "notify.windows.com"] as const;

export const MAX_ENDPOINT_LENGTH = 1024;

/** NT-55: https, the default port, no credentials, on a known push service. */
export const isPushEndpoint = (endpoint: string): boolean => {
  if (endpoint.length > MAX_ENDPOINT_LENGTH) return false;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.port !== "" || url.username !== "" || url.password !== "") return false;
  const host = url.hostname;
  return PUSH_SERVICES.some((service) => host === service || host.endsWith(`.${service}`));
};

// ---- Sending ----------------------------------------------------------------------

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/**
 * Sends one push (RFC 8030) and returns the push service's status, or 0 if it
 * couldn't be reached. Redirects aren't followed, so the Worker only ever calls
 * an allowed endpoint (NT-55).
 */
export const sendPush = async (
  env: VapidEnv,
  sub: PushTarget,
  payload: PushPayload,
  fetchImpl?: FetchLike,
  nowMs = Date.now()
): Promise<number> => {
  if (!isPushEndpoint(sub.endpoint)) throw new Error("endpoint not allowed");
  const uaPublic = fromBase64Url(sub.p256dh);
  const authSecret = fromBase64Url(sub.auth);
  if (!uaPublic || !authSecret) throw new Error("bad subscription keys");
  // Exactly {box, kind, count}, in that order (NT-25).
  const plaintext = utf8(JSON.stringify({ box: payload.box, kind: payload.kind, count: payload.count }));
  const body = await encryptPayload(plaintext, uaPublic, authSecret);
  const doFetch: FetchLike = fetchImpl ?? ((input, init) => fetch(input, init));
  try {
    const response = await doFetch(sub.endpoint, {
      method: "POST",
      redirect: "manual",
      headers: {
        authorization: await vapidAuthorization(env, sub.endpoint, nowMs),
        "content-encoding": "aes128gcm",
        "content-type": "application/octet-stream",
        ttl: String(TTL_SECONDS),
        urgency: "normal",
        // A push service keeps only the newest message per topic for an offline device.
        topic: payload.box,
      },
      body,
    });
    // Nothing in the answer is needed; don't keep the connection waiting on it.
    await response.body?.cancel().catch(() => undefined);
    return response.status;
  } catch {
    return 0;
  }
};
