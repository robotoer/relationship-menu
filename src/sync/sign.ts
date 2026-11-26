/**
 * Signed requests (SY-6), matching server/src/auth.ts and the wire protocol in
 * server/README.md:
 *
 *   Authorization: MenuSync v1 account=<id>, key=<pub>, ts=<seconds>, sig=<sig>
 *
 * `sig` is Ed25519 over five lines joined by "\n":
 *
 *   menu-sync/v1
 *   <METHOD>
 *   <path and query, exactly as sent>
 *   <ts>
 *   <base64url(SHA-256(body))>
 *
 * server/test/client-vectors.test.ts checks the vectors in test-vectors.ts with
 * the server's own authenticate(), so the two can't drift apart.
 */

import { type Bytes, sha256, toBase64Url, utf8 } from "./bytes";
import type { SyncKeys } from "./keys";

export const PROTOCOL = "menu-sync/v1";

/** The server accepts ts up to 12 digits (server/src/auth.ts). */
const MAX_TS = 999_999_999_999;

/** The five signed lines, exactly as server/src/auth.ts canonicalRequest builds them. */
export const canonicalRequest = (method: string, pathAndQuery: string, ts: number, bodyHash: string): string =>
  [PROTOCOL, method.toUpperCase(), pathAndQuery, String(ts), bodyHash].join("\n");

/**
 * The path and query as the server will read them. fetch() and the Worker's
 * `new URL(request.url)` both apply WHATWG URL parsing, so this applies it too
 * (it percent-encodes spaces, drops an empty "?", and so on). Anything other
 * than a path on our own origin is refused.
 */
export const requestPath = (pathAndQuery: string): string => {
  const base = "https://sync.invalid";
  if (!pathAndQuery.startsWith("/") || pathAndQuery.includes("#")) {
    throw new Error("Expected a path and query, such as /v1/menus?since=0.");
  }
  const url = new URL(pathAndQuery, base);
  if (url.origin !== base) throw new Error("Expected a path and query, such as /v1/menus?since=0.");
  return url.pathname + url.search;
};

/**
 * The Authorization header for one request. `body` is the exact bytes sent (a
 * string is sent as UTF-8; use "" for none). `ts` is Unix time in seconds; the
 * server allows ±5 minutes.
 */
export const authorizationHeader = async (
  keys: Pick<SyncKeys, "accountId" | "publicKey" | "signingKey">,
  method: string,
  pathAndQuery: string,
  body: Uint8Array | string,
  ts: number
): Promise<string> => {
  if (!/^[A-Za-z]+$/.test(method)) throw new Error("Expected an HTTP method, such as GET.");
  if (!Number.isSafeInteger(ts) || ts < 0 || ts > MAX_TS) throw new Error("Expected a Unix time in seconds.");
  const bytes: Bytes = typeof body === "string" ? utf8(body) : new Uint8Array(body);
  const message = canonicalRequest(method, requestPath(pathAndQuery), ts, toBase64Url(await sha256(bytes)));
  const signature = new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, keys.signingKey, utf8(message)));
  return `MenuSync v1 account=${keys.accountId}, key=${toBase64Url(keys.publicKey)}, ts=${ts}, sig=${toBase64Url(signature)}`;
};
