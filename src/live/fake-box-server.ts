/**
 * An in-memory box server that follows docs/spec/notifications.md §7a, for the
 * app's tests (the Worker's own tests check the real one). It verifies member
 * signatures the way the server does, so a signing mistake fails here too.
 */

import { fromBase64Url, sha256, toBase64Url, utf8 } from "../sync/bytes";
import { boxCanonicalRequest, memberIdFor } from "./box-crypto";

type Box = {
  host: string;
  joinHash: string | null;
  inviteExpiresAt: number;
  seq: number;
  members: Map<string, Uint8Array>;
  copies: Map<string, { version: number; seq: number; updatedAt: number; ciphertext: Uint8Array }>;
  readOnly: boolean;
};

export const createFakeBoxServer = ({ now = () => Date.now() } = {}) => {
  const boxes = new Map<string, Box>();
  /** Every PUT's Notify header, in order (to check NT-23 from the app's side). */
  const notifications: { boxId: string; memberId: string; notify: string | null }[] = [];
  /** Push subscriptions by id (§7b). */
  const subscriptions = new Map<string, { boxId: string; memberId: string; endpoint: string; p256dh: string; auth: string }>();
  let pushKey: Uint8Array | null = new Uint8Array(65).fill(4);

  const reply = (status: number, body?: unknown) =>
    new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const error = (status: number, code: string, extra: Record<string, unknown> = {}) => reply(status, { error: code, ...extra });

  const authMember = async (request: Request, boxId: string, body: Uint8Array) => {
    const header = request.headers.get("authorization") ?? "";
    const m = header.match(/^MenuBox v1 box=([^,]+), key=([^,]+), ts=(\d+), sig=(.+)$/);
    if (!m || m[1] !== boxId) return null;
    const key = fromBase64Url(m[2]);
    const sig = fromBase64Url(m[4]);
    if (!key || !sig) return null;
    if (Math.abs(now() / 1000 - Number(m[3])) > 300) return null;
    const url = new URL(request.url);
    const message = boxCanonicalRequest(request.method, url.pathname + url.search, Number(m[3]), toBase64Url(await sha256(body)));
    const publicKey = await crypto.subtle.importKey("raw", key, { name: "Ed25519" }, false, ["verify"]);
    if (!(await crypto.subtle.verify({ name: "Ed25519" }, publicKey, sig, utf8(message)))) return null;
    const memberId = await memberIdFor(key);
    const box = boxes.get(boxId);
    if (!box || !box.members.has(memberId)) return null;
    return { memberId, box };
  };

  const handle = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const body = new Uint8Array(await request.arrayBuffer());
    const path = url.pathname;
    let m: RegExpMatchArray | null;

    if (request.method === "GET" && path === "/v1/push/key") {
      return pushKey ? reply(200, { key: toBase64Url(pushKey) }) : error(503, "push_unavailable");
    }

    if (request.method === "POST" && path === "/v1/boxes") {
      // The sync account's signature is checked by the real server; here any MenuSync header will do.
      const account = (request.headers.get("authorization") ?? "").match(/account=([^,]+)/)?.[1];
      if (!account) return error(401, "unauthorized");
      const { boxId, joinHash, hostKey } = JSON.parse(new TextDecoder().decode(body));
      if (boxes.has(boxId)) return error(409, "box_exists");
      const key = fromBase64Url(hostKey)!;
      const memberId = await memberIdFor(key);
      boxes.set(boxId, {
        host: memberId,
        joinHash,
        inviteExpiresAt: now() + 7 * 86_400_000,
        seq: 0,
        members: new Map([[memberId, key]]),
        copies: new Map(),
        readOnly: false,
      });
      return reply(201, { boxId, memberId, inviteExpiresAt: now() + 7 * 86_400_000 });
    }

    if ((m = path.match(/^\/v1\/boxes\/([^/]+)\/members$/)) && request.method === "POST") {
      const box = boxes.get(m[1]);
      if (!box) return error(404, "not_found");
      const { key, join } = JSON.parse(new TextDecoder().decode(body));
      if (!box.joinHash || box.inviteExpiresAt < now()) return error(410, "invite_expired");
      if (toBase64Url(await sha256(fromBase64Url(join)!)) !== box.joinHash) return error(403, "bad_join");
      const publicKey = fromBase64Url(key)!;
      const memberId = await memberIdFor(publicKey);
      if (!box.members.has(memberId) && box.members.size >= 16) return error(409, "box_full");
      box.members.set(memberId, publicKey);
      return reply(201, { memberId });
    }

    if ((m = path.match(/^\/v1\/boxes\/([^/]+)/))) {
      const boxId = m[1];
      if (!boxes.has(boxId)) return error(404, "not_found");
      const caller = await authMember(request, boxId, body);
      if (!caller) return error(401, "unauthorized");
      const { box, memberId } = caller;

      if (request.method === "GET" && path === `/v1/boxes/${boxId}/copies`) {
        const since = Number(url.searchParams.get("since") ?? 0);
        const copies = [...box.copies.entries()]
          .filter(([, c]) => c.seq > since)
          .sort((a, b) => a[1].seq - b[1].seq)
          .map(([id, c]) => ({ memberId: id, version: c.version, seq: c.seq, updatedAt: c.updatedAt, ciphertext: toBase64Url(c.ciphertext) }));
        return reply(200, { copies, seq: box.seq, readOnly: box.readOnly, members: box.members.size });
      }
      if ((m = path.match(/^\/v1\/boxes\/[^/]+\/copies\/([^/]+)$/)) && request.method === "PUT") {
        if (m[1] !== memberId) return error(403, "not_yours");
        if (box.readOnly) return error(402, "read_only");
        const current = box.copies.get(memberId);
        const ifNone = request.headers.get("if-none-match") === "*";
        const ifMatch = request.headers.get("if-match")?.match(/^"?(\d+)"?$/)?.[1];
        if (!ifNone && ifMatch === undefined) return error(428, "precondition_required");
        if ((ifNone && current) || (!ifNone && current?.version !== Number(ifMatch))) {
          return error(412, "version_mismatch", { current: current ? { version: current.version } : null });
        }
        box.seq += 1;
        const version = (current?.version ?? 0) + 1;
        box.copies.set(memberId, { version, seq: box.seq, updatedAt: now(), ciphertext: body });
        notifications.push({ boxId, memberId, notify: request.headers.get("notify") });
        return reply(200, { version, seq: box.seq });
      }
      if (request.method === "POST" && path === `/v1/boxes/${boxId}/subscriptions`) {
        const sub = JSON.parse(new TextDecoder().decode(body));
        if (!/^https:\/\/[^/]*(fcm\.googleapis\.com|push\.apple\.com|push\.services\.mozilla\.com|notify\.windows\.com)\//.test(sub.endpoint)) {
          return error(400, "bad_endpoint");
        }
        const existing = [...subscriptions].find(([, x]) => x.boxId === boxId && x.memberId === memberId && x.endpoint === sub.endpoint);
        if (existing) return reply(201, { subId: existing[0] });
        const subId = `sub${subscriptions.size}`.padEnd(22, "x");
        subscriptions.set(subId, { boxId, memberId, ...sub });
        return reply(201, { subId });
      }
      if ((m = path.match(/^\/v1\/boxes\/[^/]+\/subscriptions\/([^/]+)$/)) && request.method === "DELETE") {
        const sub = subscriptions.get(m[1]);
        if (!sub || sub.boxId !== boxId || sub.memberId !== memberId) return error(404, "not_found");
        subscriptions.delete(m[1]);
        return reply(204);
      }
      if (request.method === "POST" && path === `/v1/boxes/${boxId}/invite`) {
        if (memberId !== box.host) return error(403, "not_host");
        box.joinHash = JSON.parse(new TextDecoder().decode(body)).joinHash;
        box.inviteExpiresAt = now() + 7 * 86_400_000;
        return reply(200, { inviteExpiresAt: box.inviteExpiresAt });
      }
      if (request.method === "DELETE" && path === `/v1/boxes/${boxId}/members/me`) {
        if (memberId === box.host) return error(409, "host_must_stop");
        box.members.delete(memberId);
        box.copies.delete(memberId);
        for (const [id, sub] of subscriptions) if (sub.boxId === boxId && sub.memberId === memberId) subscriptions.delete(id);
        return reply(204);
      }
      if (request.method === "DELETE" && path === `/v1/boxes/${boxId}`) {
        if (memberId !== box.host) return error(403, "not_host");
        boxes.delete(boxId);
        for (const [id, sub] of subscriptions) if (sub.boxId === boxId) subscriptions.delete(id);
        return reply(204);
      }
    }
    return error(404, "not_found");
  };

  return {
    boxes,
    notifications,
    subscriptions,
    /** Turns push off on the server (503 push_unavailable). */
    disablePush: () => (pushKey = null),
    fetch: ((input: RequestInfo | URL, init?: RequestInit) =>
      handle(new Request(new URL(String(input), "https://app.test"), init))) as typeof fetch,
  };
};
