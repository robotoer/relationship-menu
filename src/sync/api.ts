/**
 * Supporter sync: calls to the sync server (spec §7; the wire protocol is in
 * server/README.md). The API is on the app's own address (SY-41), so `origin` is
 * "" in the app. Every call but the pairing read is signed (SY-6).
 *
 * Nothing here logs. A failed call throws `ApiError` with only the HTTP status,
 * the server's error code and, for 412, the current record.
 */

import type { AccountStatus, CheckoutPlan, SyncAccount } from "./context";
import type { SyncKeys } from "./keys";
import { Bytes, toBase64Url, utf8 } from "./bytes";
import { PROTOCOL, authorizationHeader } from "./sign";

export class ApiError extends Error {
  constructor(
    /** The HTTP status, or 0 when there was no answer. */
    readonly status: number,
    /** The server's `{"error": …}` code, `offline`, or `failed`. */
    readonly code: string,
    /** From `Retry-After` (429). */
    readonly retryAfterMs?: number,
    /** The rest of the server's error body, e.g. `{ current }` with a 412. */
    readonly details?: Record<string, unknown>
  ) {
    super(`${status} ${code}`);
    this.name = "ApiError";
  }
}

/** One row of `GET /v1/menus`. */
export type ServerRow = { id: string; version: number; seq: number; deleted: boolean; updatedAt: number; ciphertext: string };

export type PullPage = {
  menus: ServerRow[];
  next: number;
  more: boolean;
  resync: boolean;
  /** The account's newest forgotten tombstone (`purged_seq`). */
  purged?: number;
};

type Signer = Pick<SyncKeys, "accountId" | "publicKey" | "signingKey">;

export type ApiOptions = {
  /** Where the API is. "" (the default) means this page's own address. */
  origin?: string;
  fetch?: typeof fetch;
  /** Unix ms. */
  now?: () => number;
  /** Once aborted, nothing more is sent through this API (its calls fail as offline). */
  signal?: AbortSignal;
};

const retryAfterMs = (response: Response) => {
  const seconds = Number(response.headers.get("retry-after"));
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const num = (value: unknown, fallback: number) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);
const numOrNull = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);

const STATUSES = ["none", "active", "past_due", "lifetime", "lapsed"] as const;
const PLANS = ["supporter_6_yearly", "supporter_12_yearly", "supporter_24_yearly", "supporter_30_lifetime"] as const;

/** `GET /v1/account`, read defensively: anything unexpected becomes "no supporter status". */
export const parseAccount = (value: unknown): SyncAccount => {
  const v = isObject(value) ? value : {};
  const limits = isObject(v.limits) ? v.limits : {};
  const usage = isObject(v.usage) ? v.usage : {};
  const status = STATUSES.find((s) => s === v.status) ?? "none";
  return {
    status,
    plan: PLANS.find((p) => p === v.plan) ?? null,
    renewsAt: numOrNull(v.renewsAt),
    readOnly: typeof v.readOnly === "boolean" ? v.readOnly : status === "none" || status === "lapsed",
    lapsedAt: numOrNull(v.lapsedAt),
    purgeAt: numOrNull(v.purgeAt),
    purgeSoon: v.purgeSoon === true,
    limits: { menus: num(limits.menus, 500), menuBytes: num(limits.menuBytes, 65536), totalBytes: num(limits.totalBytes, 4194304) },
    usage: { menus: num(usage.menus, 0), bytes: num(usage.bytes, 0) },
  };
};

/** The message the new key signs for `POST /v1/account/rotate` (server/src/accounts.ts). */
export const rotationMessage = (oldAccountId: string, newAccountId: string, ts: number) =>
  [PROTOCOL, "rotate", oldAccountId, newAccountId, String(ts)].join("\n");

type SendOptions = {
  body?: Uint8Array;
  json?: unknown;
  headers?: Record<string, string>;
  signed?: boolean;
  keepalive?: boolean;
  /** Unix seconds for the signature (rotation signs the same ts twice). */
  ts?: number;
};

const sender = (signer: Signer | null, { origin = "", fetch: fetchImpl, now = Date.now, signal }: ApiOptions) => {
  const doFetch = fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  return async (method: string, path: string, options: SendOptions = {}): Promise<Response> => {
    const body: Bytes =
      options.json !== undefined ? utf8(JSON.stringify(options.json)) : new Uint8Array(options.body ?? new Uint8Array());
    const headers: Record<string, string> = { ...options.headers };
    if (options.json !== undefined) headers["content-type"] = "application/json";
    else if (options.body) headers["content-type"] = "application/octet-stream";
    if (options.signed !== false) {
      if (!signer) throw new Error("This call must be signed.");
      headers.authorization = await authorizationHeader(signer, method, path, body, options.ts ?? Math.floor(now() / 1000));
    }
    let response: Response;
    try {
      // Checked here, right before sending: signing above may have taken a while.
      if (signal?.aborted) throw new DOMException("Not sent", "AbortError");
      response = await doFetch(`${origin}${path}`, {
        method,
        headers,
        body: method === "GET" ? undefined : body,
        keepalive: options.keepalive,
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
        signal,
      });
    } catch {
      throw new ApiError(0, "offline");
    }
    if (response.ok) return response;
    let details: Record<string, unknown> | undefined;
    try {
      const parsed: unknown = await response.json();
      if (isObject(parsed)) details = parsed;
    } catch {
      // Not JSON (a proxy's error page, say).
    }
    throw new ApiError(response.status, typeof details?.error === "string" ? details.error : "failed", retryAfterMs(response), details);
  };
};

const readJson = async (response: Response): Promise<Record<string, unknown>> => {
  try {
    const parsed: unknown = await response.json();
    if (isObject(parsed)) return parsed;
  } catch {
    // fall through
  }
  throw new ApiError(response.status, "bad_response");
};

/** A URL the server handed back for Stripe, checked to be https before the browser goes there. */
const httpsUrl = (value: unknown): string => {
  if (typeof value === "string") {
    try {
      if (new URL(value).protocol === "https:") return value;
    } catch {
      // fall through
    }
  }
  throw new ApiError(200, "bad_response");
};

const written = async (response: Response) => {
  const body = await readJson(response);
  const version = body.version;
  const seq = body.seq;
  if (typeof version !== "number" || typeof seq !== "number") throw new ApiError(response.status, "bad_response");
  return { version, seq };
};

const ifMatch = (version: number | null): Record<string, string> =>
  version === null ? { "if-none-match": "*" } : { "if-match": `"${version}"` };

export type SyncApi = ReturnType<typeof createApi>;

/** The signed API for one account. */
export const createApi = (keys: Signer, options: ApiOptions = {}) => {
  const send = sender(keys, options);
  const now = options.now ?? Date.now;
  return {
    accountId: keys.accountId,

    /** `GET /v1/account`. */
    account: async (): Promise<SyncAccount> => parseAccount(await readJson(await send("GET", "/v1/account"))),

    /** `GET /v1/account`'s status, strictly: null unless the answer plainly says one. */
    accountStatus: async (): Promise<AccountStatus | null> => {
      const body = await readJson(await send("GET", "/v1/account"));
      return STATUSES.find((s) => s === body.status) ?? null;
    },

    /**
     * `GET /v1/menus?since=` (SY-32). `full` marks the pages of a full listing.
     * A page that isn't exactly what the server sends is refused as a whole: a
     * full listing treats every menu it doesn't list as deleted, so a garbled or
     * partly read page must never pass for a short one.
     */
    pull: async (since: number, full = false): Promise<PullPage> => {
      const response = await send("GET", `/v1/menus?since=${since}${full ? "&full=1" : ""}`);
      const body = await readJson(response);
      const bad = () => new ApiError(response.status, "bad_response");
      if (!Array.isArray(body.menus) || typeof body.next !== "number" || typeof body.more !== "boolean") throw bad();
      if (typeof body.resync !== "boolean" || (body.purged !== undefined && typeof body.purged !== "number")) throw bad();
      // A page that asks for another must move the cursor on, or the next pull asks for the same one forever.
      if (body.more && !body.resync && !(Number.isSafeInteger(body.next) && body.next > since)) throw bad();
      const rows = body.menus.map((m: unknown): ServerRow => {
        if (!isObject(m)) throw bad();
        const { id, version, seq, deleted, updatedAt, ciphertext } = m;
        if (typeof id !== "string" || typeof version !== "number" || typeof seq !== "number") throw bad();
        if (typeof deleted !== "boolean" || typeof ciphertext !== "string") throw bad();
        return { id, version, seq, deleted, updatedAt: num(updatedAt, 0), ciphertext };
      });
      return {
        menus: rows,
        next: body.next,
        more: body.more,
        resync: body.resync,
        ...(typeof body.purged === "number" ? { purged: body.purged } : {}),
      };
    },

    /** `PUT /v1/menus/:id`: `version` is the If-Match, or null for a new menu (SY-42). */
    put: async (id: string, record: Uint8Array, version: number | null, keepalive = false) =>
      written(await send("PUT", `/v1/menus/${id}`, { body: record, headers: ifMatch(version), keepalive })),

    /** `DELETE /v1/menus/:id` with an encrypted tombstone (SY-19). */
    remove: async (id: string, tombstone: Uint8Array, version: number, keepalive = false) =>
      written(await send("DELETE", `/v1/menus/${id}`, { body: tombstone, headers: ifMatch(version), keepalive })),

    /** `POST /v1/checkout`: the Stripe Checkout URL (SY-61). */
    checkout: async (plan: CheckoutPlan): Promise<string> =>
      httpsUrl((await readJson(await send("POST", "/v1/checkout", { json: { plan } }))).url),

    /** `POST /v1/portal`: the Stripe Customer Portal URL (SY-64). */
    portal: async (): Promise<string> => httpsUrl((await readJson(await send("POST", "/v1/portal", { json: {} }))).url),

    /** `POST /v1/pair` (SY-10). Resolves to when the server forgets it. */
    pair: async (id: string, blob: string): Promise<number> => {
      const body = await readJson(await send("POST", "/v1/pair", { json: { id, blob } }));
      return num(body.expiresAt, now() + 10 * 60_000);
    },

    /** `POST /v1/account/rotate` (SY-8): moves supporter status to `next`. Resolves to its account id. */
    rotate: async (next: Signer): Promise<string> => {
      const ts = Math.floor(now() / 1000);
      const message = utf8(rotationMessage(keys.accountId, next.accountId, ts));
      const proof = new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, next.signingKey, message));
      const body = await readJson(
        await send("POST", "/v1/account/rotate", { json: { key: toBase64Url(next.publicKey), proof: toBase64Url(proof) }, ts })
      );
      if (body.accountId !== next.accountId) throw new ApiError(200, "bad_response");
      return next.accountId;
    },

    /** `DELETE /v1/account` (SY-68). */
    deleteAccount: async (): Promise<void> => {
      await send("DELETE", "/v1/account");
    },

    /** An Authorization header for another signed call (the AI coach). */
    authorize: (method: string, pathAndQuery: string, body: Uint8Array) =>
      authorizationHeader(keys, method, pathAndQuery, body, Math.floor(now() / 1000)),
  };
};

/** `GET /v1/pair/:id`, unsigned: the pairing blob, once (SY-10). */
export const readPairing = async (id: string, options: ApiOptions = {}): Promise<string> => {
  const body = await readJson(await sender(null, options)("GET", `/v1/pair/${encodeURIComponent(id)}`, { signed: false }));
  if (typeof body.blob !== "string") throw new ApiError(200, "bad_response");
  return body.blob;
};
