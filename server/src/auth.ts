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
 *
 * Live-sharing boxes (docs/spec/notifications.md §7a, NT-12) sign the same way,
 * with their own scheme and label, so a sync signature never passes as a box one:
 *
 *   Authorization: MenuBox v1 box=<box id>, key=<pub>, ts=<seconds>, sig=<sig>
 *
 * - `key` is the device's own box key (not derived from a sync code).
 * - the member id = base64url(first 16 bytes of SHA-256(key)).
 * - `sig` covers the same five lines, with `menu-box/v1` as the first.
 * - `box` must be the box in the request's path.
 */

import { ID_PATTERN, fromBase64Url, sha256, toBase64Url, utf8 } from "./bytes";
import { HttpError } from "./http";

export const PROTOCOL = "menu-sync/v1";
export const BOX_PROTOCOL = "menu-box/v1";
export const MAX_SKEW_SECONDS = 300;

export const accountIdForKey = async (publicKey: Uint8Array): Promise<string> =>
  toBase64Url((await sha256(publicKey)).slice(0, 16));

/** A box member's id: derived from its key the same way as an account id (NT-12). */
export const memberIdForKey = accountIdForKey;

const canonicalLines = (label: string, method: string, pathAndQuery: string, ts: number, bodyHash: string): string =>
  [label, method.toUpperCase(), pathAndQuery, String(ts), bodyHash].join("\n");

export const canonicalRequest = (method: string, pathAndQuery: string, ts: number, bodyHash: string): string =>
  canonicalLines(PROTOCOL, method, pathAndQuery, ts, bodyHash);

/** The lines a box member signs (§7a): as canonicalRequest, labelled `menu-box/v1`. */
export const canonicalBoxRequest = (method: string, pathAndQuery: string, ts: number, bodyHash: string): string =>
  canonicalLines(BOX_PROTOCOL, method, pathAndQuery, ts, bodyHash);

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

/** A request signed with a box key. Membership is checked separately (boxes.ts loadMember). */
export type BoxCaller = {
  boxId: string;
  memberId: string;
  publicKey: Uint8Array;
  ts: number;
};

const unauthorized = () => new HttpError(401, "unauthorized");

/** Parses `<scheme> v1 a=b, c=d`. */
const parseHeader = (header: string | null, scheme: "MenuSync" | "MenuBox"): Record<string, string> | null => {
  const match = header?.match(new RegExp(`^${scheme} v1 (.+)$`));
  if (!match?.[1]) return null;
  const fields: Record<string, string> = {};
  for (const part of match[1].split(",")) {
    const eq = part.indexOf("=");
    if (eq < 0) return null;
    fields[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return fields;
};

/**
 * Checks `ts`, `key` and `sig` from a parsed header against the request, for
 * `id` (the account or box the header names). Returns the key, the id it
 * hashes to, and the timestamp; throws 401 otherwise.
 */
const verifySigned = async (
  request: Request,
  body: Uint8Array,
  fields: Record<string, string>,
  id: string | undefined,
  canonical: typeof canonicalRequest,
  nowMs: number
) => {
  const { key, ts: tsText, sig } = fields;
  if (!id || !key || !tsText || !sig || !ID_PATTERN.test(id) || !/^\d{1,12}$/.test(tsText)) throw unauthorized();
  const ts = Number(tsText);
  if (Math.abs(nowMs / 1000 - ts) > MAX_SKEW_SECONDS) throw new HttpError(401, "clock_skew");
  const publicKey = fromBase64Url(key);
  const signature = fromBase64Url(sig);
  if (publicKey?.length !== 32 || signature?.length !== 64) throw unauthorized();
  const url = new URL(request.url);
  const message = canonical(request.method, url.pathname + url.search, ts, toBase64Url(await sha256(body)));
  if (!(await verifyEd25519(publicKey, signature, utf8(message)))) throw unauthorized();
  return { publicKey, keyId: await accountIdForKey(publicKey), ts };
};

/** Verifies the request's signature over `body`; returns the caller or throws 401. */
export const authenticate = async (request: Request, body: Uint8Array, nowMs = Date.now()): Promise<Caller> => {
  const fields = parseHeader(request.headers.get("authorization"), "MenuSync");
  if (!fields) throw unauthorized();
  const { publicKey, keyId, ts } = await verifySigned(request, body, fields, fields.account, canonicalRequest, nowMs);
  if (keyId !== fields.account) throw unauthorized();
  return { accountId: keyId, publicKey, ts };
};

/**
 * Verifies a box member's signature (§7a, NT-12) for the box in the path:
 * 400 for a malformed box id, 401 for a bad or mismatched header. Whether the
 * key is a member of the box is checked by loadMember (boxes.ts), after the
 * rate limit, so unsigned noise never reaches D1.
 */
export const authenticateMember = async (
  request: Request,
  body: Uint8Array,
  pathBoxId: string,
  nowMs = Date.now()
): Promise<BoxCaller> => {
  if (!ID_PATTERN.test(pathBoxId)) throw new HttpError(400, "bad_request");
  const fields = parseHeader(request.headers.get("authorization"), "MenuBox");
  if (!fields) throw unauthorized();
  const { publicKey, keyId, ts } = await verifySigned(request, body, fields, fields.box, canonicalBoxRequest, nowMs);
  if (fields.box !== pathBoxId) throw unauthorized();
  return { boxId: pathBoxId, memberId: keyId, publicKey, ts };
};
