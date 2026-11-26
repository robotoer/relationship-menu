/**
 * The box routes (docs/spec/notifications.md §7a), as the app calls them. Member
 * requests are signed with this device's box key; creating a box is signed with
 * the supporter's sync account (passed in as `authorizeAccount`).
 */

import { type Bytes, fromBase64Url, toBase64Url, utf8 } from "../sync/bytes";
import { DeviceKey, memberAuthorization } from "./box-crypto";

export type LiveFailure =
  | "offline"
  | "not_supporter"
  | "read_only"
  | "too_many_boxes"
  | "box_exists"
  | "not_found"
  | "bad_join"
  | "invite_expired"
  | "box_full"
  | "version_mismatch"
  | "too_large"
  | "rate_limited"
  | "push_unavailable"
  | "bad_endpoint"
  | "too_many_subscriptions"
  | "failed";

export class LiveError extends Error {
  constructor(
    readonly reason: LiveFailure,
    readonly status = 0,
    readonly body: Record<string, unknown> = {}
  ) {
    super(reason);
    this.name = "LiveError";
  }
}

export type Copy = { memberId: string; version: number; seq: number; updatedAt: number; ciphertext: Bytes };
export type CopiesPage = { copies: Copy[]; seq: number; readOnly: boolean; members: number };
export type Notify = "comment" | "notes" | "none";

/** A box member on this device: the box and this device's key for it. */
export type Member = { boxId: string; device: Pick<DeviceKey, "keys" | "publicKey" | "memberId"> };

type AuthorizeAccount = (method: string, pathAndQuery: string, body: Uint8Array) => Promise<string>;

const KNOWN = new Set<LiveFailure>([
  "not_supporter", "read_only", "too_many_boxes", "box_exists", "not_found", "bad_join",
  "invite_expired", "box_full", "version_mismatch", "push_unavailable", "bad_endpoint", "too_many_subscriptions",
]);

const failure = (status: number, code: unknown): LiveFailure => {
  if (typeof code === "string" && KNOWN.has(code as LiveFailure)) return code as LiveFailure;
  if (status === 404) return "not_found";
  if (status === 413) return "too_large";
  if (status === 429) return "rate_limited";
  if (status === 412) return "version_mismatch";
  return "failed";
};

export const createBoxApi = ({
  origin = "",
  fetch: doFetch = (...args: Parameters<typeof fetch>) => fetch(...args),
  now = () => Date.now(),
}: { origin?: string; fetch?: typeof fetch; now?: () => number } = {}) => {
  const send = async (
    method: string,
    path: string,
    { body = new Uint8Array(), headers = {}, sign }: { body?: Uint8Array; headers?: Record<string, string>; sign?: (body: Uint8Array) => Promise<string> }
  ): Promise<Record<string, unknown>> => {
    const h = new Headers(headers);
    if (sign) h.set("authorization", await sign(body));
    let response: Response;
    try {
      response = await doFetch(`${origin}${path}`, { method, headers: h, body: body.length ? new Uint8Array(body) : undefined });
    } catch {
      throw new LiveError("offline");
    }
    const data = response.status === 204 ? {} : await response.json().catch(() => ({}));
    if (!response.ok) throw new LiveError(failure(response.status, (data as { error?: unknown }).error), response.status, data);
    return data as Record<string, unknown>;
  };
  const ts = () => Math.floor(now() / 1000);
  const asMember = (m: Member, method: string, path: string) => (body: Uint8Array) =>
    memberAuthorization(m.boxId, m.device, method, path, body, ts());
  const jsonBody = (value: unknown) => utf8(JSON.stringify(value));
  const JSON_HEADERS = { "content-type": "application/json" };

  return {
    /** POST /v1/boxes, signed by the supporter's sync account (NT-10). */
    create: async (authorizeAccount: AuthorizeAccount, request: { boxId: string; joinHash: string; hostKey: Uint8Array }) => {
      const path = "/v1/boxes";
      const body = jsonBody({ boxId: request.boxId, joinHash: request.joinHash, hostKey: toBase64Url(request.hostKey) });
      const data = await send("POST", path, { body, headers: JSON_HEADERS, sign: (b) => authorizeAccount("POST", path, b) });
      return { memberId: String(data.memberId), inviteExpiresAt: Number(data.inviteExpiresAt) };
    },
    /** POST /v1/boxes/:id/members (NT-12). */
    join: async (boxId: string, device: Pick<DeviceKey, "publicKey">, join: Uint8Array) => {
      const data = await send("POST", `/v1/boxes/${boxId}/members`, {
        body: jsonBody({ key: toBase64Url(device.publicKey), join: toBase64Url(join) }),
        headers: JSON_HEADERS,
      });
      return { memberId: String(data.memberId) };
    },
    /** POST /v1/boxes/:id/invite (NT-13), host only. */
    invite: async (m: Member, joinHash: string) => {
      const path = `/v1/boxes/${m.boxId}/invite`;
      const data = await send("POST", path, { body: jsonBody({ joinHash }), headers: JSON_HEADERS, sign: asMember(m, "POST", path) });
      return { inviteExpiresAt: Number(data.inviteExpiresAt) };
    },
    /** GET /v1/boxes/:id/copies?since=<seq> (NT-4). */
    copies: async (m: Member, since: number): Promise<CopiesPage> => {
      const path = `/v1/boxes/${m.boxId}/copies?since=${since}`;
      const data = await send("GET", path, { sign: asMember(m, "GET", path) });
      const copies: Copy[] = [];
      for (const c of Array.isArray(data.copies) ? (data.copies as Record<string, unknown>[]) : []) {
        const ciphertext = typeof c.ciphertext === "string" ? fromBase64Url(c.ciphertext) : null;
        if (!ciphertext || typeof c.memberId !== "string") continue;
        copies.push({ memberId: c.memberId, version: Number(c.version), seq: Number(c.seq), updatedAt: Number(c.updatedAt), ciphertext });
      }
      return { copies, seq: Number(data.seq) || 0, readOnly: data.readOnly === true, members: Number(data.members) || 0 };
    },
    /** PUT /v1/boxes/:id/copies/:memberId (NT-3): `version` is the one this device last wrote, or null for the first. */
    put: async (m: Member, version: number | null, ciphertext: Uint8Array, notify: Notify) => {
      const path = `/v1/boxes/${m.boxId}/copies/${m.device.memberId}`;
      const data = await send("PUT", path, {
        body: ciphertext,
        headers: {
          "content-type": "application/octet-stream",
          notify,
          ...(version === null ? { "if-none-match": "*" } : { "if-match": `"${version}"` }),
        },
        sign: asMember(m, "PUT", path),
      });
      return { version: Number(data.version), seq: Number(data.seq) };
    },
    /** DELETE /v1/boxes/:id/members/me (NT-14). */
    leave: async (m: Member) => {
      const path = `/v1/boxes/${m.boxId}/members/me`;
      await send("DELETE", path, { sign: asMember(m, "DELETE", path) });
    },
    /** GET /v1/push/key (§7b): the VAPID public key, or LiveError("push_unavailable"). */
    pushKey: async () => {
      const data = await send("GET", "/v1/push/key", {});
      const key = typeof data.key === "string" ? fromBase64Url(data.key) : null;
      if (!key || key.length !== 65) throw new LiveError("push_unavailable");
      return key;
    },
    /** POST /v1/boxes/:id/subscriptions (§7b). */
    subscribe: async (m: Member, sub: { endpoint: string; p256dh: string; auth: string }) => {
      const path = `/v1/boxes/${m.boxId}/subscriptions`;
      const data = await send("POST", path, { body: jsonBody(sub), headers: JSON_HEADERS, sign: asMember(m, "POST", path) });
      return { subId: String(data.subId) };
    },
    /** DELETE /v1/boxes/:id/subscriptions/:subId (§7b). */
    unsubscribe: async (m: Member, subId: string) => {
      const path = `/v1/boxes/${m.boxId}/subscriptions/${encodeURIComponent(subId)}`;
      await send("DELETE", path, { sign: asMember(m, "DELETE", path) });
    },
    /** DELETE /v1/boxes/:id (NT-15), host only. */
    remove: async (m: Member) => {
      const path = `/v1/boxes/${m.boxId}`;
      await send("DELETE", path, { sign: asMember(m, "DELETE", path) });
    },
  };
};

export type BoxApi = ReturnType<typeof createBoxApi>;
