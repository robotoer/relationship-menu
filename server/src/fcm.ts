/**
 * Store-app push through Firebase Cloud Messaging HTTP v1, with WebCrypto only
 * (docs/spec/notifications.md §6 NT-40…NT-42, §7c):
 *
 * - The Worker holds a Google service account (`FCM_SERVICE_ACCOUNT`, its JSON
 *   key). It signs an RS256 JWT (iss = client_email, the firebase.messaging
 *   scope, aud = the token endpoint, valid 1 hour) and exchanges it at
 *   https://oauth2.googleapis.com/token for an access token, cached per isolate
 *   until a minute before it expires.
 * - Each push is one `messages:send` to
 *   https://fcm.googleapis.com/v1/projects/<project_id>/messages:send, with fixed,
 *   generic notification text and the data {box, kind, count} (NT-41).
 *
 * Those two fixed Google addresses are the only ones ever called here: nothing
 * in a URL comes from a client, and the project id is checked to be a plain
 * Google project id. Redirects aren't followed.
 */

import { concat, toBase64Url, utf8 } from "./bytes";
import type { Env } from "./env";
import type { FetchLike, PushPayload } from "./webpush";

export const FCM_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
/** The send address for a (checked) project id. */
export const fcmSendUrl = (projectId: string) => `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;

/** How long the signed assertion is valid (Google allows at most 1 hour), in seconds. */
export const ASSERTION_LIFETIME_SECONDS = 3600;
/** An access token is used until this long before it expires. */
export const TOKEN_REFRESH_EARLY_MS = 60_000;
/** FCM and APNs keep an undelivered message this long, in seconds (as web push's TTL). */
export const FCM_TTL_SECONDS = 86400;

/** An FCM registration token (§7c): 1–4096 characters of [A-Za-z0-9_:-]. */
export const FCM_TOKEN_PATTERN = /^[A-Za-z0-9_:-]{1,4096}$/;
export type FcmPlatform = "android" | "ios";
export const isFcmPlatform = (value: unknown): value is FcmPlatform => value === "android" || value === "ios";

/** The fixed lock-screen text (NT-41): no names, no topics. */
export const FCM_TITLE = "Wants & Won'ts";
export const fcmBody = (count: number) =>
  count > 1 ? `${count} new changes in a conversation.` : "Something new in a conversation.";

/** What one attempt came to, for notify.ts (shared with web push). */
export type PushOutcome = {
  /**
   * sent; gone (delete the subscription); retry (keep waiting for the cron);
   * auth (keep waiting, the service account is at fault); failed (dropped).
   */
  result: "sent" | "gone" | "retry" | "auth" | "failed";
  /** The HTTP status, or 0 if there was no answer. */
  status: number;
  /** The log code (SY-44): never anything from the request or the answer. */
  code: string;
};

export type FcmOptions = { fetch?: FetchLike; nowMs?: number };

const doFetch = (options: FcmOptions): FetchLike => options.fetch ?? ((input, init) => fetch(input, init));

// ---- The service account ------------------------------------------------------------

export type ServiceAccount = { projectId: string; clientEmail: string; privateKeyPkcs8: Uint8Array };

/** A Google Cloud project id: 6–30 lowercase letters, digits and hyphens, starting with a letter. */
const PROJECT_ID = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const CLIENT_EMAIL = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,190}$/;
const PEM = /^-----BEGIN PRIVATE KEY-----([A-Za-z0-9+/=\s]+)-----END PRIVATE KEY-----$/;

/** Reads the service account's JSON key; null if anything is missing or malformed. */
export const parseServiceAccount = (secret: string | undefined): ServiceAccount | null => {
  if (!secret) return null;
  let value: unknown;
  try {
    value = JSON.parse(secret);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { type, project_id: projectId, client_email: clientEmail, private_key: privateKey } = value as Record<string, unknown>;
  if (type !== undefined && type !== "service_account") return null;
  if (typeof projectId !== "string" || !PROJECT_ID.test(projectId)) return null;
  if (typeof clientEmail !== "string" || !CLIENT_EMAIL.test(clientEmail)) return null;
  if (typeof privateKey !== "string") return null;
  const pem = privateKey.trim().match(PEM);
  if (!pem) return null;
  let der: Uint8Array;
  try {
    const binary = atob(pem[1]!.replace(/\s+/g, ""));
    der = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
  // A DER SEQUENCE, of at least the size of an RSA 2048 key.
  if (der.length < 1000 || der[0] !== 0x30) return null;
  return { projectId, clientEmail, privateKeyPkcs8: der };
};

/** The service account, ready to sign, with its cached access token. */
export type FcmAccount = {
  projectId: string;
  clientEmail: string;
  key: CryptoKey;
  token: { value: string; obtainedAt: number; expiresAt: number } | null;
};

const RS256 = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } as const;

let accountCache: { secret: string; account: Promise<FcmAccount | null> } | null = null;

const loadAccount = async (secret: string): Promise<FcmAccount | null> => {
  const parsed = parseServiceAccount(secret);
  if (!parsed) return null;
  try {
    const key = await crypto.subtle.importKey("pkcs8", parsed.privateKeyPkcs8, RS256, false, ["sign"]);
    if (((key.algorithm as { modulusLength?: number }).modulusLength ?? 0) < 2048) return null;
    return { projectId: parsed.projectId, clientEmail: parsed.clientEmail, key, token: null };
  } catch {
    return null;
  }
};

/**
 * The Worker's FCM service account, or null when `FCM_SERVICE_ACCOUNT` is
 * missing or malformed (then FCM is off: 503 push_unavailable, §7c). Imported
 * once per isolate and secret.
 */
export const fcmAccount = (env: Env): Promise<FcmAccount | null> => {
  const secret = env.FCM_SERVICE_ACCOUNT;
  if (!secret) return Promise.resolve(null);
  if (accountCache?.secret !== secret) accountCache = { secret, account: loadAccount(secret) };
  return accountCache.account;
};

/** Tests only: forget the imported account and its access token. */
export const resetFcmCache = () => {
  accountCache = null;
};

// ---- OAuth (RFC 7523 JWT bearer grant) -------------------------------------------------

const jsonPart = (value: unknown) => toBase64Url(utf8(JSON.stringify(value)));

/** The signed assertion exchanged for an access token. */
export const fcmAssertion = async (account: FcmAccount, nowMs = Date.now()): Promise<string> => {
  const iat = Math.floor(nowMs / 1000);
  const unsigned = `${jsonPart({ alg: "RS256", typ: "JWT" })}.${jsonPart({
    iss: account.clientEmail,
    scope: FCM_SCOPE,
    aud: FCM_TOKEN_URL,
    iat,
    exp: iat + ASSERTION_LIFETIME_SECONDS,
  })}`;
  const signature = new Uint8Array(await crypto.subtle.sign(RS256, account.key, utf8(unsigned)));
  return `${unsigned}.${toBase64Url(signature)}`;
};

/** Printable ASCII without spaces, as a bearer token must be (RFC 6750). */
const ACCESS_TOKEN = /^[\x21-\x7e]{1,4096}$/;

export type AccessToken = { ok: true; token: string } | { ok: false; outcome: PushOutcome };

/**
 * An access token for FCM: the cached one while it has more than a minute left,
 * else a new one from the token endpoint. A failure says how the sends waiting
 * on it should be treated: 429, 5xx or no answer → retry; anything else
 * (a rejected key, an unexpected answer) → auth. Either way nothing is dropped.
 */
export const fcmAccessToken = async (account: FcmAccount, options: FcmOptions = {}): Promise<AccessToken> => {
  const nowMs = options.nowMs ?? Date.now();
  const cached = account.token;
  if (cached && nowMs >= cached.obtainedAt && nowMs < cached.expiresAt - TOKEN_REFRESH_EARLY_MS) {
    return { ok: true, token: cached.value };
  }
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: await fcmAssertion(account, nowMs),
  });
  let response: Response;
  try {
    response = await doFetch(options)(FCM_TOKEN_URL, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
  } catch {
    return { ok: false, outcome: { result: "retry", status: 0, code: "push_unreachable" } };
  }
  const status = response.status;
  if (status !== 200) {
    await response.body?.cancel().catch(() => undefined);
    const retry = status === 429 || status >= 500;
    return { ok: false, outcome: { result: retry ? "retry" : "auth", status, code: retry ? "push_retry" : "push_auth" } };
  }
  let answer: unknown;
  try {
    answer = await response.json();
  } catch {
    answer = null;
  }
  const { access_token: value, expires_in: expiresIn } = (answer ?? {}) as Record<string, unknown>;
  if (typeof value !== "string" || !ACCESS_TOKEN.test(value) || typeof expiresIn !== "number" || !(expiresIn > 0)) {
    return { ok: false, outcome: { result: "auth", status, code: "push_auth" } };
  }
  account.token = { value, obtainedAt: nowMs, expiresAt: nowMs + expiresIn * 1000 };
  return { ok: true, token: value };
};

// ---- Sending ----------------------------------------------------------------------

/** The `messages:send` body (§7c). Data values are strings, as FCM requires. */
export const fcmMessage = (token: string, payload: PushPayload, nowMs = Date.now()) => ({
  message: {
    token,
    notification: { title: FCM_TITLE, body: fcmBody(payload.count) },
    data: { box: payload.box, kind: payload.kind, count: String(payload.count) },
    android: {
      // FCM keeps only the newest per box for an offline device; the tag replaces the shown one.
      collapse_key: payload.box,
      priority: "normal",
      ttl: `${FCM_TTL_SECONDS}s`,
      notification: { tag: `box-${payload.box}` },
    },
    apns: {
      headers: {
        "apns-collapse-id": payload.box,
        "apns-priority": "5",
        "apns-expiration": String(Math.floor(nowMs / 1000) + FCM_TTL_SECONDS),
      },
      payload: { aps: { "thread-id": payload.box } },
    },
  },
});

/** FCM's error details: its own errorCode, and whether a field violation is about the token. */
const fcmError = (body: string): { status?: string; errorCode?: string; aboutToken: boolean } => {
  try {
    const error = (JSON.parse(body) as { error?: unknown }).error as
      | { status?: unknown; message?: unknown; details?: unknown }
      | undefined;
    if (!error || typeof error !== "object") return { aboutToken: false };
    const details = Array.isArray(error.details) ? (error.details as Record<string, unknown>[]) : [];
    const errorCode = details.map((d) => d?.errorCode).find((c): c is string => typeof c === "string");
    const aboutToken =
      details.some(
        (d) => Array.isArray(d?.fieldViolations) && (d.fieldViolations as { field?: unknown }[]).some((v) => v?.field === "message.token")
      ) ||
      (typeof error.message === "string" && /registration token/i.test(error.message));
    return { status: typeof error.status === "string" ? error.status : undefined, errorCode, aboutToken };
  } catch {
    return { aboutToken: false };
  }
};

/** At most this much of an error answer is read. */
const MAX_ERROR_BYTES = 16 * 1024;

const readError = async (response: Response): Promise<string> => {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
    if (total >= MAX_ERROR_BYTES) {
      await reader.cancel().catch(() => undefined);
      break;
    }
  }
  return new TextDecoder().decode(concat(...chunks));
};

/**
 * Sends one push to an FCM registration token with an access token from
 * fcmAccessToken, and says what came of it (§7c):
 * - 200 → sent;
 * - 404, or 400 with UNREGISTERED, or INVALID_ARGUMENT about the token → gone;
 * - 429, 5xx or no answer → retry (the cron sends it later);
 * - 401 / 403 → auth: keep waiting (a broken service account mustn't drop
 *   people's subscriptions); a 401 also forgets the cached access token;
 * - anything else (another 4xx, a redirect) → failed: dropped, the subscription stays.
 */
export const sendFcm = async (
  account: FcmAccount,
  accessToken: string,
  token: string,
  payload: PushPayload,
  options: FcmOptions = {}
): Promise<PushOutcome> => {
  if (!FCM_TOKEN_PATTERN.test(token)) throw new Error("bad FCM token");
  const nowMs = options.nowMs ?? Date.now();
  let response: Response;
  try {
    response = await doFetch(options)(fcmSendUrl(account.projectId), {
      method: "POST",
      redirect: "manual",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify(fcmMessage(token, payload, nowMs)),
    });
  } catch {
    return { result: "retry", status: 0, code: "push_unreachable" };
  }
  const status = response.status;
  if (status === 400) {
    const error = fcmError(await readError(response).catch(() => ""));
    const unregistered = error.errorCode === "UNREGISTERED" || error.status === "UNREGISTERED";
    const badToken = (error.errorCode === "INVALID_ARGUMENT" || error.status === "INVALID_ARGUMENT") && error.aboutToken;
    return unregistered || badToken ? { result: "gone", status, code: "push_gone" } : { result: "failed", status, code: "push_failed" };
  }
  await response.body?.cancel().catch(() => undefined);
  if (status === 200) return { result: "sent", status, code: "sent" };
  if (status === 404) return { result: "gone", status, code: "push_gone" };
  if (status === 429 || status >= 500) return { result: "retry", status, code: "push_retry" };
  if (status === 401 || status === 403) {
    if (status === 401 && account.token?.value === accessToken) account.token = null;
    return { result: "auth", status, code: "push_auth" };
  }
  return { result: "failed", status, code: "push_failed" };
};
