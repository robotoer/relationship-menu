/**
 * Live-sharing boxes (docs/spec/notifications.md §2, §3, §7a; NT-1…NT-17).
 *
 * A box holds one conversation shared live: one encrypted copy per member
 * device. Each device writes only its own copy, conditional on its version, so
 * the server never merges anything. It stores only ciphertext, device public
 * keys and SHA-256 of the join secret; the box key never reaches it.
 */

import { canWrite, requireWritable, type Status } from "./accounts";
import { memberIdForKey, type BoxCaller, type Caller } from "./auth";
import { ID_PATTERN, fromBase64Url, sha256, timingSafeEqual, toBase64Url } from "./bytes";
import { BOX_LIMITS, INVITE_TTL_MS, type Env } from "./env";
import { HttpError, json, noContent, parseJson } from "./http";

type BoxRow = {
  box_id: string;
  host_account: string;
  join_hash: string | null;
  invite_expires_at: number | null;
  seq: number;
  created_at: number;
};

type CopyRow = {
  member_id: string;
  version: number;
  seq: number;
  updated_at: number;
  ciphertext: ArrayBuffer;
};

/** A verified member of an existing box. */
export type Member = {
  boxId: string;
  memberId: string;
  isHost: boolean;
  /** False once the host's support has lapsed (NT-16): members can read, not write. */
  writable: boolean;
};

/** Nonce (12) + GCM tag (16): anything shorter can't be a copy. */
const MIN_COPY_BYTES = 28;

const badRequest = () => new HttpError(400, "bad_request");
const notFound = () => new HttpError(404, "not_found");

const checkId = (id: string) => {
  if (!ID_PATTERN.test(id)) throw badRequest();
};

/** A base64url field that must decode to exactly 32 bytes (keys, SHA-256 hashes). */
const bytes32 = (value: unknown): Uint8Array | null => {
  const bytes = typeof value === "string" ? fromBase64Url(value) : null;
  return bytes?.length === 32 ? bytes : null;
};

const getBox = (db: D1Database, boxId: string) =>
  db.prepare("SELECT * FROM boxes WHERE box_id = ?").bind(boxId).first<BoxRow>();

const isMember = async (db: D1Database, boxId: string, memberId: string) =>
  (await db.prepare("SELECT 1 AS one FROM box_members WHERE box_id = ? AND member_id = ?").bind(boxId, memberId).first()) !== null;

/**
 * The box and the caller's place in it: 404 if the box doesn't exist (also after
 * Stop sharing), 403 `not_member` if the key isn't one of its members.
 */
export const loadMember = async (env: Env, caller: BoxCaller): Promise<Member> => {
  const row = await env.DB.prepare(
    `SELECT m.is_host AS is_host, a.status AS host_status
     FROM boxes b
     LEFT JOIN box_members m ON m.box_id = b.box_id AND m.member_id = ?2
     LEFT JOIN accounts a ON a.account_id = b.host_account
     WHERE b.box_id = ?1`
  )
    .bind(caller.boxId, caller.memberId)
    .first<{ is_host: number | null; host_status: Status | null }>();
  if (!row) throw notFound();
  if (row.is_host === null) throw new HttpError(403, "not_member");
  return {
    boxId: caller.boxId,
    memberId: caller.memberId,
    isHost: row.is_host === 1,
    writable: row.host_status !== null && canWrite(row.host_status),
  };
};

/**
 * POST /v1/boxes (NT-10) — body {boxId, joinHash, hostKey}. Signed by a
 * supporter's sync account, which becomes the host. The host's device joins as
 * the first member; it then writes its first copy with If-None-Match: *.
 */
export const createBox = async (env: Env, caller: Caller, body: Uint8Array): Promise<Response> => {
  const input = parseJson(body);
  const boxId = typeof input.boxId === "string" && ID_PATTERN.test(input.boxId) ? input.boxId : null;
  const joinHash = bytes32(input.joinHash);
  const hostKey = bytes32(input.hostKey);
  if (!boxId || !joinHash || !hostKey) throw badRequest();
  await requireWritable(env, caller);
  const memberId = await memberIdForKey(hostKey);
  const now = Date.now();
  const inviteExpiresAt = now + INVITE_TTL_MS;
  // One transaction: the box only if the id is free and the account is under its
  // limit, and the host member only into the box just made (a fresh box has no
  // members; an existing one always has its host).
  const results = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO boxes (box_id, host_account, join_hash, invite_expires_at, seq, created_at)
       SELECT ?1, ?2, ?3, ?4, 0, ?5
       WHERE NOT EXISTS (SELECT 1 FROM boxes WHERE box_id = ?1)
         AND (SELECT COUNT(*) FROM boxes WHERE host_account = ?2) < ?6`
    ).bind(boxId, caller.accountId, toBase64Url(joinHash), inviteExpiresAt, now, BOX_LIMITS.boxes),
    env.DB.prepare(
      `INSERT INTO box_members (box_id, member_id, public_key, is_host, joined_at)
       SELECT ?1, ?2, ?3, 1, ?4
       WHERE EXISTS (SELECT 1 FROM boxes WHERE box_id = ?1 AND host_account = ?5)
         AND NOT EXISTS (SELECT 1 FROM box_members WHERE box_id = ?1)`
    ).bind(boxId, memberId, hostKey, now, caller.accountId),
  ]);
  if (results[0]?.meta.changes !== 1) {
    if (await getBox(env.DB, boxId)) throw new HttpError(409, "box_exists");
    throw new HttpError(429, "too_many_boxes", { limit: BOX_LIMITS.boxes });
  }
  return json({ boxId, memberId, inviteExpiresAt }, 201);
};

/**
 * POST /v1/boxes/:id/members (NT-12) — unauthenticated; body {key, join}. J
 * admits the device's key as a member. Joining again is harmless.
 */
export const joinBox = async (env: Env, boxId: string, body: Uint8Array): Promise<Response> => {
  checkId(boxId);
  const input = parseJson(body);
  const key = bytes32(input.key);
  const join = typeof input.join === "string" ? fromBase64Url(input.join) : null;
  if (!key || !join || join.length === 0) throw badRequest();
  const box = await getBox(env.DB, boxId);
  if (!box) throw notFound();
  const now = Date.now();
  if (box.join_hash === null || box.invite_expires_at === null || box.invite_expires_at <= now) {
    throw new HttpError(410, "invite_expired");
  }
  const joinHash = toBase64Url(await sha256(join));
  if (!timingSafeEqual(joinHash, box.join_hash)) throw new HttpError(403, "bad_join");
  const memberId = await memberIdForKey(key);
  // The same invite and the member limit are checked again in the write itself,
  // so a concurrent new invite or join can't slip past them.
  const inserted = await env.DB.prepare(
    `INSERT OR IGNORE INTO box_members (box_id, member_id, public_key, is_host, joined_at)
     SELECT ?1, ?2, ?3, 0, ?4
     WHERE EXISTS (SELECT 1 FROM boxes WHERE box_id = ?1 AND join_hash = ?5 AND invite_expires_at > ?4)
       AND (SELECT COUNT(*) FROM box_members WHERE box_id = ?1) < ?6`
  )
    .bind(boxId, memberId, key, now, joinHash, BOX_LIMITS.members)
    .run();
  if (inserted.meta.changes === 1 || (await isMember(env.DB, boxId, memberId))) {
    return json({ memberId }, 201);
  }
  const after = await getBox(env.DB, boxId);
  if (!after) throw notFound();
  if (after.join_hash !== joinHash) throw new HttpError(403, "bad_join");
  throw new HttpError(409, "box_full", { limit: BOX_LIMITS.members });
};

/**
 * POST /v1/boxes/:id/invite (NT-13) — host only; body {joinHash}. Replaces J,
 * which ends the old link for new joins; members stay.
 */
export const newInvite = async (env: Env, member: Member, body: Uint8Array): Promise<Response> => {
  if (!member.isHost) throw new HttpError(403, "not_host");
  const joinHash = bytes32(parseJson(body).joinHash);
  if (!joinHash) throw badRequest();
  // NT-16: a lapsed host's box is read-only, and that includes letting new people in.
  if (!member.writable) throw new HttpError(402, "read_only");
  const inviteExpiresAt = Date.now() + INVITE_TTL_MS;
  await env.DB.prepare("UPDATE boxes SET join_hash = ?2, invite_expires_at = ?3 WHERE box_id = ?1")
    .bind(member.boxId, toBase64Url(joinHash), inviteExpiresAt)
    .run();
  return json({ inviteExpiresAt });
};

/**
 * GET /v1/boxes/:id/copies?since=<seq> (NT-4) — the copies written after `since`
 * (all of them for 0), oldest first, with the box's seq, whether it is read-only,
 * and how many members it has. One batch, so `seq` and the copies agree.
 */
export const listCopies = async (env: Env, member: Member, url: URL): Promise<Response> => {
  const sinceText = url.searchParams.get("since") ?? "0";
  if (!/^\d{1,15}$/.test(sinceText)) throw badRequest();
  const [box, copies, members] = await env.DB.batch<Record<string, unknown>>([
    env.DB.prepare("SELECT seq FROM boxes WHERE box_id = ?").bind(member.boxId),
    env.DB.prepare(
      "SELECT member_id, version, seq, updated_at, ciphertext FROM box_copies WHERE box_id = ? AND seq > ? ORDER BY seq"
    ).bind(member.boxId, Number(sinceText)),
    env.DB.prepare("SELECT COUNT(*) AS n FROM box_members WHERE box_id = ?").bind(member.boxId),
  ]);
  const seq = (box?.results[0] as { seq: number } | undefined)?.seq;
  if (seq === undefined) throw notFound();
  return json({
    copies: ((copies?.results ?? []) as CopyRow[]).map((row) => ({
      memberId: row.member_id,
      version: row.version,
      seq: row.seq,
      updatedAt: row.updated_at,
      ciphertext: toBase64Url(new Uint8Array(row.ciphertext)),
    })),
    seq,
    readOnly: !member.writable,
    members: (members?.results[0] as { n: number } | undefined)?.n ?? 0,
  });
};

/** Parses If-Match: "3" (or 3). */
const parseIfMatch = (header: string | null): number | null => {
  const match = header?.trim().match(/^"?(\d{1,12})"?$/);
  return match?.[1] ? Number(match[1]) : null;
};

/** After a write that matched nothing: 404 if the member or box went meanwhile, else 412. */
const writeRefused = async (env: Env, member: Member) => {
  if (!(await isMember(env.DB, member.boxId, member.memberId))) return notFound();
  const current = await env.DB.prepare("SELECT version FROM box_copies WHERE box_id = ? AND member_id = ?")
    .bind(member.boxId, member.memberId)
    .first<{ version: number }>();
  return new HttpError(412, "version_mismatch", { current: current ? { version: current.version } : null });
};

/**
 * PUT /v1/boxes/:id/copies/:memberId (NT-2, NT-3, NT-5) — the caller's own copy,
 * conditional on its version (If-Match) or on there being none (If-None-Match: *).
 * The box's seq and the copy move together in one D1 batch; both statements carry
 * the same guard, so a mismatch changes nothing. `Notify` is accepted and ignored
 * until notifications exist (phase 3).
 */
export const putCopy = async (
  env: Env,
  member: Member,
  request: Request,
  memberId: string,
  body: Uint8Array
): Promise<Response> => {
  checkId(memberId);
  if (memberId !== member.memberId) throw new HttpError(403, "not_yours");
  if (body.length < MIN_COPY_BYTES) throw badRequest();
  if (!member.writable) throw new HttpError(402, "read_only");
  const now = Date.now();
  const b = member.boxId;
  const m = member.memberId;
  const isMemberSql = "EXISTS (SELECT 1 FROM box_members WHERE box_id = ?1 AND member_id = ?2)";

  if (request.headers.get("if-none-match")?.trim() === "*") {
    const noCopy = "NOT EXISTS (SELECT 1 FROM box_copies WHERE box_id = ?1 AND member_id = ?2)";
    const results = await env.DB.batch<{ version: number; seq: number }>([
      env.DB.prepare(`UPDATE boxes SET seq = seq + 1 WHERE box_id = ?1 AND ${isMemberSql} AND ${noCopy}`).bind(b, m),
      env.DB.prepare(
        `INSERT INTO box_copies (box_id, member_id, version, seq, updated_at, size, ciphertext)
         SELECT ?1, ?2, 1, seq, ?3, ?4, ?5 FROM boxes
         WHERE box_id = ?1 AND ${isMemberSql} AND ${noCopy}
         RETURNING version, seq`
      ).bind(b, m, now, body.length, body),
    ]);
    const written = results[1]?.results[0];
    if (!written) throw await writeRefused(env, member);
    return json({ version: written.version, seq: written.seq });
  }

  const expected = parseIfMatch(request.headers.get("if-match"));
  if (expected === null) throw new HttpError(428, "precondition_required");
  const results = await env.DB.batch<{ version: number; seq: number }>([
    env.DB.prepare(
      `UPDATE boxes SET seq = seq + 1
       WHERE box_id = ?1 AND EXISTS (SELECT 1 FROM box_copies WHERE box_id = ?1 AND member_id = ?2 AND version = ?3)`
    ).bind(b, m, expected),
    env.DB.prepare(
      `UPDATE box_copies SET version = version + 1, seq = (SELECT seq FROM boxes WHERE box_id = ?1),
         updated_at = ?4, size = ?5, ciphertext = ?6
       WHERE box_id = ?1 AND member_id = ?2 AND version = ?3
       RETURNING version, seq`
    ).bind(b, m, expected, now, body.length, body),
  ]);
  const written = results[1]?.results[0];
  if (!written) throw await writeRefused(env, member);
  return json({ version: written.version, seq: written.seq });
};

/** DELETE /v1/boxes/:id/members/me (NT-14) — any member but the host; its copy goes too. */
export const leaveBox = async (env: Env, member: Member): Promise<Response> => {
  if (member.isHost) throw new HttpError(409, "host_must_stop");
  await env.DB.batch([
    env.DB.prepare("DELETE FROM box_copies WHERE box_id = ? AND member_id = ?").bind(member.boxId, member.memberId),
    env.DB.prepare("DELETE FROM box_members WHERE box_id = ? AND member_id = ?").bind(member.boxId, member.memberId),
  ]);
  return noContent();
};

/** DELETE /v1/boxes/:id (NT-15) — host only: every copy, member and the box. */
export const deleteBox = async (env: Env, member: Member): Promise<Response> => {
  if (!member.isHost) throw new HttpError(403, "not_host");
  await env.DB.batch(deleteBoxesWhere(env.DB, "box_id = ?", member.boxId));
  return noContent();
};

/**
 * Statements that delete the boxes matching `where` (on `boxes`) with all their
 * members and copies. Used by Stop sharing, account deletion and the daily purge.
 */
export const deleteBoxesWhere = (db: D1Database, where: string, ...values: unknown[]): D1PreparedStatement[] => [
  db.prepare(`DELETE FROM box_copies WHERE box_id IN (SELECT box_id FROM boxes WHERE ${where})`).bind(...values),
  db.prepare(`DELETE FROM box_members WHERE box_id IN (SELECT box_id FROM boxes WHERE ${where})`).bind(...values),
  db.prepare(`DELETE FROM boxes WHERE ${where}`).bind(...values),
];
