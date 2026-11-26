/**
 * Encrypted menu records (SY-22, SY-23, SY-32, SY-42).
 *
 * The server never sees a title or an item: each record is opaque ciphertext
 * (12-byte nonce + AES-GCM output). Writes are conditional on the version the
 * device last saw, so nothing is overwritten unseen and replays fail.
 */

import { requireAccount, requireWritable, usage } from "./accounts";
import type { Caller } from "./auth";
import { ID_PATTERN, toBase64Url } from "./bytes";
import { LIMITS, type Env } from "./env";
import { HttpError, json } from "./http";

type MenuRow = {
  menu_id: string;
  version: number;
  seq: number;
  updated_at: number;
  deleted: number;
  size: number;
  ciphertext: ArrayBuffer;
};

const PAGE_SIZE = 100;
/** Nonce (12) + GCM tag (16): anything shorter can't be a record. */
const MIN_RECORD_BYTES = 28;

const toJson = (row: MenuRow) => ({
  id: row.menu_id,
  version: row.version,
  seq: row.seq,
  deleted: row.deleted === 1,
  updatedAt: row.updated_at,
  ciphertext: toBase64Url(new Uint8Array(row.ciphertext)),
});

export const checkMenuId = (id: string) => {
  if (!ID_PATTERN.test(id)) throw new HttpError(400, "bad_menu_id");
};

/** GET /v1/menus?since=<seq> — changes after `since`, oldest first, 100 per page. */
export const listMenus = async (env: Env, caller: Caller, url: URL): Promise<Response> => {
  const account = await requireAccount(env, caller);
  const sinceText = url.searchParams.get("since") ?? "0";
  if (!/^\d{1,15}$/.test(sinceText)) throw new HttpError(400, "bad_request");
  const since = Number(sinceText);
  // Tombstones older than 180 days are forgotten. A device whose cursor is older
  // than one of them must pull everything and treat synced-but-missing menus as
  // deleted (SY-23).
  if (since > 0 && since < account.purged_seq) {
    return json({ menus: [], next: 0, more: false, resync: true });
  }
  const { results } = await env.DB.prepare(
    "SELECT menu_id, version, seq, updated_at, deleted, size, ciphertext FROM menus WHERE account_id = ? AND seq > ? ORDER BY seq LIMIT ?"
  )
    .bind(caller.accountId, since, PAGE_SIZE + 1)
    .all<MenuRow>();
  const page = results.slice(0, PAGE_SIZE);
  const last = page[page.length - 1];
  return json({ menus: page.map(toJson), next: last ? last.seq : since, more: results.length > PAGE_SIZE, resync: false });
};

const currentRow = (env: Env, accountId: string, menuId: string) =>
  env.DB.prepare(
    "SELECT menu_id, version, seq, updated_at, deleted, size, ciphertext FROM menus WHERE account_id = ? AND menu_id = ?"
  )
    .bind(accountId, menuId)
    .first<MenuRow>();

/** Parses If-Match: "3" (or 3). */
const parseIfMatch = (header: string | null): number | null => {
  const match = header?.trim().match(/^"?(\d{1,12})"?$/);
  return match?.[1] ? Number(match[1]) : null;
};

const versionMismatch = async (env: Env, accountId: string, menuId: string) => {
  const current = await currentRow(env, accountId, menuId);
  return new HttpError(412, "version_mismatch", { current: current ? toJson(current) : null });
};

/** 507 if storing `size` bytes as a live record would pass the account's quota (SY-23). */
const checkQuota = async (env: Env, accountId: string, menuId: string, size: number) => {
  const [used, existing] = await Promise.all([usage(env.DB, accountId), currentRow(env, accountId, menuId)]);
  const wasLive = existing !== null && existing.deleted === 0;
  const menus = used.menus + (wasLive ? 0 : 1);
  const bytes = used.bytes - (wasLive ? existing.size : 0) + size;
  if (menus > LIMITS.menus || bytes > LIMITS.totalBytes) {
    throw new HttpError(507, "quota_exceeded", { limits: { menus: LIMITS.menus, totalBytes: LIMITS.totalBytes } });
  }
};

/**
 * Writes one record, conditional on the version (If-Match) or on its absence
 * (If-None-Match: *). The account's change counter and the record move together
 * in one D1 batch (one transaction); both statements carry the same guard, so a
 * mismatch changes nothing at all.
 */
const writeRecord = async (
  env: Env,
  caller: Caller,
  request: Request,
  menuId: string,
  ciphertext: Uint8Array,
  deleted: 0 | 1
): Promise<Response> => {
  const now = Date.now();
  const ifNoneMatch = request.headers.get("if-none-match")?.trim();
  const expected = parseIfMatch(request.headers.get("if-match"));
  const a = caller.accountId;

  if (ifNoneMatch === "*" && deleted === 0) {
    const results = await env.DB.batch<{ version: number; seq: number }>([
      env.DB.prepare(
        `UPDATE accounts SET seq = seq + 1, updated_at = ?3
         WHERE account_id = ?1 AND NOT EXISTS (SELECT 1 FROM menus WHERE account_id = ?1 AND menu_id = ?2)`
      ).bind(a, menuId, now),
      env.DB.prepare(
        `INSERT INTO menus (account_id, menu_id, version, seq, updated_at, deleted, size, ciphertext)
         SELECT ?1, ?2, 1, seq, ?3, 0, ?4, ?5 FROM accounts
         WHERE account_id = ?1 AND NOT EXISTS (SELECT 1 FROM menus WHERE account_id = ?1 AND menu_id = ?2)
         RETURNING version, seq`
      ).bind(a, menuId, now, ciphertext.length, ciphertext),
    ]);
    const written = results[1]?.results[0];
    if (!written) throw await versionMismatch(env, a, menuId);
    return json({ version: written.version, seq: written.seq });
  }

  if (expected === null) throw new HttpError(428, "precondition_required");
  const results = await env.DB.batch<{ version: number; seq: number }>([
    env.DB.prepare(
      `UPDATE accounts SET seq = seq + 1, updated_at = ?4
       WHERE account_id = ?1 AND EXISTS (SELECT 1 FROM menus WHERE account_id = ?1 AND menu_id = ?2 AND version = ?3)`
    ).bind(a, menuId, expected, now),
    env.DB.prepare(
      `UPDATE menus SET version = version + 1, seq = (SELECT seq FROM accounts WHERE account_id = ?1),
         updated_at = ?4, deleted = ?5, size = ?6, ciphertext = ?7
       WHERE account_id = ?1 AND menu_id = ?2 AND version = ?3
       RETURNING version, seq`
    ).bind(a, menuId, expected, now, deleted, ciphertext.length, ciphertext),
  ]);
  const written = results[1]?.results[0];
  if (!written) throw await versionMismatch(env, a, menuId);
  return json({ version: written.version, seq: written.seq });
};

/** PUT /v1/menus/:id — store a live (encrypted) menu. */
export const putMenu = async (
  env: Env,
  caller: Caller,
  request: Request,
  menuId: string,
  body: Uint8Array
): Promise<Response> => {
  checkMenuId(menuId);
  await requireWritable(env, caller);
  if (body.length < MIN_RECORD_BYTES) throw new HttpError(400, "bad_request");
  await checkQuota(env, caller.accountId, menuId, body.length);
  return writeRecord(env, caller, request, menuId, body, 0);
};

/**
 * DELETE /v1/menus/:id — replace the record with an encrypted tombstone (SY-19).
 * The tombstone is ciphertext too, so the server can't forge a deletion.
 */
export const deleteMenu = async (
  env: Env,
  caller: Caller,
  request: Request,
  menuId: string,
  body: Uint8Array
): Promise<Response> => {
  checkMenuId(menuId);
  await requireWritable(env, caller);
  if (body.length < MIN_RECORD_BYTES) throw new HttpError(400, "bad_request");
  return writeRecord(env, caller, request, menuId, body, 1);
};
