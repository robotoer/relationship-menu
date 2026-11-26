/**
 * One-time pairing links (SY-10, SY-12, SY-45).
 *
 * The first device encrypts the sync code with a random key K that only the QR
 * code holds, and uploads it under id = base64url(first 16 bytes of SHA-256(K)).
 * The new device fetches it once. The server never sees K or the code.
 */

import { requireAccount } from "./accounts";
import type { Caller } from "./auth";
import { ID_PATTERN, fromBase64Url, toBase64Url } from "./bytes";
import { LIMITS, PAIRING_TTL_MS, type Env } from "./env";
import { HttpError, json, parseJson } from "./http";

/** POST /v1/pair — body { id, blob }; keeps the blob for 10 minutes or one read. */
export const createPairing = async (env: Env, caller: Caller, body: Uint8Array): Promise<Response> => {
  await requireAccount(env, caller);
  const input = parseJson(body);
  const id = typeof input.id === "string" && ID_PATTERN.test(input.id) ? input.id : null;
  const blob = typeof input.blob === "string" ? fromBase64Url(input.blob) : null;
  if (!id || !blob || blob.length === 0) throw new HttpError(400, "bad_request");
  if (blob.length > LIMITS.pairingBlobBytes) throw new HttpError(413, "too_large", { max: LIMITS.pairingBlobBytes });
  const expiresAt = Date.now() + PAIRING_TTL_MS;
  const result = await env.DB.prepare("INSERT OR IGNORE INTO pairings (id, blob, expires_at) VALUES (?, ?, ?)")
    .bind(id, blob, expiresAt)
    .run();
  if (result.meta.changes !== 1) throw new HttpError(409, "pairing_exists");
  return json({ expiresAt }, 201);
};

type PairingRow = { blob: ArrayBuffer | null; expires_at: number; used_at: number | null };

/** GET /v1/pair/:id — unauthenticated; returns the blob once (SY-10). */
export const takePairing = async (env: Env, id: string): Promise<Response> => {
  if (!ID_PATTERN.test(id)) throw new HttpError(404, "not_found");
  const now = Date.now();
  const row = await env.DB.prepare("SELECT blob, expires_at, used_at FROM pairings WHERE id = ?")
    .bind(id)
    .first<PairingRow>();
  if (!row) throw new HttpError(404, "not_found");
  if (row.used_at !== null || row.blob === null) throw new HttpError(410, "used");
  if (row.expires_at <= now) throw new HttpError(410, "expired");
  // Claim it; only one reader can win.
  const claimed = await env.DB.prepare(
    "UPDATE pairings SET blob = NULL, used_at = ? WHERE id = ? AND blob IS NOT NULL AND used_at IS NULL"
  )
    .bind(now, id)
    .run();
  if (claimed.meta.changes !== 1) throw new HttpError(410, "used");
  return json({ blob: toBase64Url(new Uint8Array(row.blob)) });
};
