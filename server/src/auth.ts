/**
 * Signed requests (SY-6, SY-7).
 *
 * Every call except the webhook, health check and pairing reads carries
 *
 *   Authorization: MenuSync v1 account=<id>, key=<pub>, ts=<seconds>, sig=<sig>
 *
 * - `key` is the device's Ed25519 public key (32 bytes, base64url), derived from
 *   the sync code. The server stores no credential: it checks that the key
 *   hashes to the account id, then checks the signature.
 * - `account` = base64url(first 16 bytes of SHA-256(key)).
 * - `sig` = Ed25519 over the canonical request (lines joined by "\n"):
 *     menu-sync/v1
 *     <METHOD>
 *     <path and query, exactly as sent>
 *     <ts>
 *     <base64url(SHA-256(body))>
 * - `ts` must be within ±5 minutes of the server's clock. Writes are conditional
 *   on the current version, so replaying one fails (SY-7); no nonce table needed.
 */

import { ID_PATTERN, fromBase64Url, sha256, toBase64Url, utf8 } from "./bytes";
import { HttpError } from "./http";

export const PROTOCOL = "menu-sync/v1";
export const MAX_SKEW_SECONDS = 300;

export const accountIdForKey = async (publicKey: Uint8Array): Promise<string> =>
  toBase64Url((await sha256(publicKey)).slice(0, 16));

export const canonicalRequest = (
  method: string,
  pathAndQuery: string,
  ts: number,
  bodyHash: string
): string => [PROTOCOL, method.toUpperCase(), pathAndQuery, String(ts), bodyHash].join("\n");

export const verifyEd25519 = async (
  publicKey: Uint8Array,
  signature: Uint8Array,
  message: Uint8Array
): Promise<boolean> => {
  try {
    const key = await crypto.subtle.importKey("raw", publicKey, { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify({ name: "Ed25519" }, key, signature, message);
  } catch {
    return false;
  }
};

export type Caller = {
  accountId: string;
  publicKey: Uint8Array;
  /** The request's signed timestamp (seconds). */
  ts: number;
};

const unauthorized = () => new HttpError(401, "unauthorized");

/** Parses `MenuSync v1 a=b, c=d`. */
const parseHeader = (header: string | null): Record<string, string> | null => {
  const match = header?.match(/^MenuSync v1 (.+)$/);
  if (!match?.[1]) return null;
  const fields: Record<string, string> = {};
  for (const part of match[1].split(",")) {
    const eq = part.indexOf("=");
    if (eq < 0) return null;
    fields[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return fields;
};

/** Verifies the request's signature over `body`; returns the caller or throws 401. */
export const authenticate = async (request: Request, body: Uint8Array, nowMs = Date.now()): Promise<Caller> => {
  const fields = parseHeader(request.headers.get("authorization"));
  if (!fields) throw unauthorized();
  const { account, key, ts: tsText, sig } = fields;
  if (!account || !key || !tsText || !sig || !ID_PATTERN.test(account) || !/^\d{1,12}$/.test(tsText)) {
    throw unauthorized();
  }
  const ts = Number(tsText);
  if (Math.abs(nowMs / 1000 - ts) > MAX_SKEW_SECONDS) throw new HttpError(401, "clock_skew");
  const publicKey = fromBase64Url(key);
  const signature = fromBase64Url(sig);
  if (publicKey?.length !== 32 || signature?.length !== 64) throw unauthorized();
  if ((await accountIdForKey(publicKey)) !== account) throw unauthorized();
  const url = new URL(request.url);
  const message = canonicalRequest(request.method, url.pathname + url.search, ts, toBase64Url(await sha256(body)));
  if (!(await verifyEd25519(publicKey, signature, utf8(message)))) throw unauthorized();
  return { accountId: account, publicKey, ts };
};
