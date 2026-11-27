/**
 * An in-memory stand-in for the sync server, for tests only. It speaks the wire
 * protocol in server/README.md: it checks signatures (SY-6) and versions (SY-42),
 * pages pulls by seq (SY-32), refuses pushes without supporter status (SY-66),
 * keeps pairing blobs for one read (SY-10), and rotates and deletes accounts
 * (SY-8, SY-68). Stripe is reduced to `setStatus`.
 *
 * The real server is tested in server/test/; this one lets app tests run whole
 * devices against each other.
 */

import type { AccountStatus, CheckoutPlan } from "./context";
import { accountIdForKey } from "./keys";
import { canonicalRequest } from "./sign";
import { fromBase64Url, sha256, toBase64Url, utf8 } from "./bytes";
import { rotationMessage } from "./api";

type Row = { id: string; version: number; seq: number; deleted: boolean; updatedAt: number; ciphertext: string; size: number };
type Account = {
  status: AccountStatus;
  plan: CheckoutPlan | null;
  seq: number;
  purgedSeq: number;
  menus: Map<string, Row>;
  customer: boolean;
};

export type FakeRequest = { method: string; path: string; account: string | null; status: number; bodyText: string };

const LIMITS = { menus: 500, menuBytes: 65536, totalBytes: 4 * 1024 * 1024 };
const PAGE = 100;

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const error = (status: number, code: string, extra: Record<string, unknown> = {}) => json(status, { error: code, ...extra });

const writable = (status: AccountStatus) => status === "active" || status === "past_due" || status === "lifetime";

const verify = async (key: Uint8Array, signature: Uint8Array, message: Uint8Array) => {
  const publicKey = await crypto.subtle.importKey("raw", new Uint8Array(key), { name: "Ed25519" }, false, ["verify"]);
  return crypto.subtle.verify({ name: "Ed25519" }, publicKey, new Uint8Array(signature), new Uint8Array(message));
};

export const createFakeServer = (options: { now?: () => number } = {}) => {
  const now = options.now ?? Date.now;
  /** How long a rotation takes between being accepted and committing (the real one: any time, but at most 60 s). */
  let rotationCommitDelayMs = 0;
  const accounts = new Map<string, Account>();
  const pairings = new Map<string, { blob: string; expiresAt: number; used: boolean }>();
  const requests: FakeRequest[] = [];
  let online = true;
  /** When set, the next matching request is answered with this status (once). */
  const failNext: { match: (method: string, path: string) => boolean; status: number }[] = [];

  const account = (id: string) => accounts.get(id);
  const ensure = (id: string): Account => {
    let a = accounts.get(id);
    if (!a) {
      a = { status: "none", plan: null, seq: 0, purgedSeq: 0, menus: new Map(), customer: false };
      accounts.set(id, a);
    }
    return a;
  };

  const authenticate = async (method: string, pathAndQuery: string, header: string | null, body: Uint8Array) => {
    const match = header?.match(/^MenuSync v1 account=([A-Za-z0-9_-]{22}), key=([A-Za-z0-9_-]+), ts=(\d{1,12}), sig=([A-Za-z0-9_-]+)$/);
    if (!match) return null;
    const [, accountId, keyText, tsText, sigText] = match as unknown as [string, string, string, string, string];
    const key = fromBase64Url(keyText);
    const sig = fromBase64Url(sigText);
    if (key?.length !== 32 || sig?.length !== 64) return null;
    if ((await accountIdForKey(key)) !== accountId) return null;
    const ts = Number(tsText);
    if (Math.abs(ts - Math.floor(now() / 1000)) > 300) return null;
    const message = canonicalRequest(method, pathAndQuery, ts, toBase64Url(await sha256(body)));
    if (!(await verify(key, sig, utf8(message)))) return null;
    return { accountId, ts };
  };

  const accountJson = (a: Account | undefined) => {
    if (!a || a.status === "none") {
      return { status: "none", plan: null, readOnly: true, limits: LIMITS, usage: { menus: 0, bytes: 0 } };
    }
    const live = [...a.menus.values()].filter((r) => !r.deleted);
    return {
      status: a.status,
      plan: a.plan,
      renewsAt: a.status === "lifetime" ? null : now() + 365 * 86_400_000,
      cancelAtPeriodEnd: false,
      readOnly: !writable(a.status),
      lapsedAt: a.status === "lapsed" ? now() : null,
      purgeAt: a.status === "lapsed" ? now() + 365 * 86_400_000 : null,
      purgeSoon: false,
      limits: LIMITS,
      usage: { menus: live.length, bytes: live.reduce((n, r) => n + r.size, 0) },
    };
  };

  const rowJson = ({ size: _size, ...row }: Row) => row;

  const handle = async (method: string, url: URL, headers: Headers, body: Uint8Array): Promise<Response> => {
    const path = url.pathname;
    const pathAndQuery = path + url.search;
    if (method === "GET" && path.startsWith("/v1/pair/")) {
      const id = decodeURIComponent(path.slice("/v1/pair/".length));
      const p = pairings.get(id);
      if (!p) return error(404, "not_found");
      if (p.used) return error(410, "used");
      if (p.expiresAt < now()) return error(410, "expired");
      p.used = true;
      return json(200, { blob: p.blob });
    }
    const caller = await authenticate(method, pathAndQuery, headers.get("authorization"), body);
    if (!caller) return error(401, "unauthorized");
    const a = account(caller.accountId);
    const requireAccount = () => (a && a.status !== "none" ? a : null);

    if (method === "GET" && path === "/v1/account") return json(200, accountJson(a));

    if (method === "DELETE" && path === "/v1/menus") {
      if (a) {
        a.menus.clear();
        a.seq += 1;
        a.purgedSeq = a.seq;
      }
      return new Response(null, { status: 204 });
    }

    if (method === "GET" && path === "/v1/menus") {
      const acc = requireAccount();
      if (!acc) return error(402, "not_supporter");
      const since = Number(url.searchParams.get("since") ?? "0");
      const full = url.searchParams.get("full") === "1";
      if (!full && since > 0 && since < acc.purgedSeq) {
        return json(200, { menus: [], next: 0, more: false, resync: true, purged: acc.purgedSeq });
      }
      const rows = [...acc.menus.values()].filter((r) => r.seq > since).sort((x, y) => x.seq - y.seq);
      const page = rows.slice(0, PAGE);
      return json(200, {
        menus: page.map(rowJson),
        next: page.length ? page[page.length - 1]!.seq : since,
        more: rows.length > PAGE,
        resync: false,
        purged: acc.purgedSeq,
      });
    }

    const menu = path.match(/^\/v1\/menus\/([A-Za-z0-9_-]{22})$/);
    if (menu && (method === "PUT" || method === "DELETE")) {
      const id = menu[1]!;
      if (!a || a.status === "none") return error(402, "not_supporter");
      if (!writable(a.status)) return error(402, "read_only");
      if (body.length > (method === "PUT" ? LIMITS.menuBytes : 4096)) return error(413, "too_large");
      const existing = a.menus.get(id);
      const current = existing ? rowJson(existing) : null;
      const ifNoneMatch = headers.get("if-none-match");
      const ifMatch = headers.get("if-match")?.match(/^"?(\d+)"?$/)?.[1];
      let version: number;
      if (ifNoneMatch === "*" && method === "PUT") {
        if (existing) return error(412, "version_mismatch", { current });
        version = 1;
      } else if (ifMatch !== undefined) {
        if (!existing || existing.version !== Number(ifMatch)) return error(412, "version_mismatch", { current });
        version = existing.version + 1;
      } else {
        return error(428, "precondition_required");
      }
      if (method === "PUT") {
        const live = [...a.menus.values()].filter((r) => !r.deleted && r.id !== id);
        if (live.length + 1 > LIMITS.menus || live.reduce((n, r) => n + r.size, 0) + body.length > LIMITS.totalBytes) {
          return error(507, "quota_exceeded");
        }
      }
      a.seq += 1;
      a.menus.set(id, {
        id,
        version,
        seq: a.seq,
        deleted: method === "DELETE",
        updatedAt: now(),
        ciphertext: toBase64Url(body),
        size: body.length,
      });
      return json(200, { version, seq: a.seq });
    }

    const input = (() => {
      try {
        return JSON.parse(new TextDecoder().decode(body)) as Record<string, unknown>;
      } catch {
        return {};
      }
    })();

    if (method === "POST" && path === "/v1/checkout") {
      if (a && writable(a.status)) return error(409, "already_supporter");
      return json(200, { url: `https://checkout.stripe.test/${String(input.plan)}` });
    }
    if (method === "POST" && path === "/v1/portal") {
      if (!a?.customer) return error(402, "not_supporter");
      return json(200, { url: "https://billing.stripe.test/portal" });
    }
    if (method === "POST" && path === "/v1/pair") {
      if (!a || !writable(a.status)) return error(402, "not_supporter");
      if (typeof input.id !== "string" || typeof input.blob !== "string") return error(400, "bad_request");
      if (pairings.has(input.id)) return error(409, "exists");
      const expiresAt = now() + 10 * 60_000;
      pairings.set(input.id, { blob: input.blob, expiresAt, used: false });
      return json(201, { expiresAt });
    }
    if (method === "POST" && path === "/v1/account/rotate") {
      const received = now();
      const acc = requireAccount();
      if (!acc) return error(402, "not_supporter");
      const key = typeof input.key === "string" ? fromBase64Url(input.key) : null;
      const proof = typeof input.proof === "string" ? fromBase64Url(input.proof) : null;
      if (key?.length !== 32 || proof?.length !== 64) return error(400, "bad_request");
      const next = await accountIdForKey(key);
      if (!(await verify(key, proof, utf8(rotationMessage(caller.accountId, next, caller.ts))))) return error(401, "unauthorized");
      if (accounts.has(next)) return error(409, "account_exists");
      if (rotationCommitDelayMs > 0) await new Promise((r) => setTimeout(r, rotationCommitDelayMs));
      // As server/src/accounts.ts: within 60 s of arriving, or not at all.
      if (now() - received > 60_000) return error(503, "rotation_too_slow");
      accounts.set(next, { ...acc, seq: 0, purgedSeq: 0, menus: new Map() });
      accounts.delete(caller.accountId);
      return json(200, { accountId: next });
    }
    if (method === "DELETE" && path === "/v1/account") {
      accounts.delete(caller.accountId);
      return json(204, null);
    }
    return error(404, "not_found");
  };

  const fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(String(input), "http://app.test");
    const method = (init.method ?? "GET").toUpperCase();
    if (init.signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
    if (!online) throw new TypeError("Failed to fetch");
    const headers = new Headers(init.headers);
    const body = init.body ? new Uint8Array(init.body as ArrayBuffer | Uint8Array) : new Uint8Array();
    const accountMatch = headers.get("authorization")?.match(/account=([A-Za-z0-9_-]{22})/);
    // Recorded as it arrives (so the order is the order requests were sent); status once answered.
    const entry: FakeRequest = {
      method,
      path: url.pathname + url.search,
      account: accountMatch?.[1] ?? null,
      status: 0,
      bodyText: new TextDecoder().decode(body),
    };
    requests.push(entry);
    const forced = failNext.findIndex((f) => f.match(method, url.pathname));
    let response: Response;
    if (forced >= 0) {
      const [f] = failNext.splice(forced, 1);
      response = error(f!.status, f!.status === 429 ? "rate_limited" : "failed", {});
    } else {
      response = await handle(method, url, headers, body);
    }
    entry.status = response.status;
    return response;
  };

  return {
    fetch,
    requests,
    accounts,
    /** What Stripe's webhooks would set (SY-62). */
    setStatus: (accountId: string, status: AccountStatus, plan: CheckoutPlan | null = "supporter_12_yearly") => {
      const a = ensure(accountId);
      a.status = status;
      a.plan = plan;
      a.customer = true;
    },
    delayRotationCommit: (ms: number) => {
      rotationCommitDelayMs = ms;
    },
    setOnline: (value: boolean) => {
      online = value;
    },
    isOnline: () => online,
    failNext: (match: (method: string, path: string) => boolean, status: number) => failNext.push({ match, status }),
    /** Forgets tombstones (the daily cron, SY-23): bumps purgedSeq past them. */
    forgetTombstones: (accountId: string) => {
      const a = account(accountId);
      if (!a) return;
      for (const [id, row] of a.menus) {
        if (row.deleted) {
          a.menus.delete(id);
          a.purgedSeq = Math.max(a.purgedSeq, row.seq);
        }
      }
    },
    liveMenuIds: (accountId: string) => [...(account(accountId)?.menus.values() ?? [])].filter((r) => !r.deleted).map((r) => r.id).sort(),
  };
};

export type FakeServer = ReturnType<typeof createFakeServer>;
