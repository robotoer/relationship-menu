/** Supporter accounts: status, limits and the account endpoints (SY-8, SY-63, SY-66…SY-68). */

import { PROTOCOL, accountIdForKey, verifyEd25519, type Caller } from "./auth";
import { fromBase64Url, utf8 } from "./bytes";
import { LIMITS, PURGE_AFTER_MS, PURGE_WARNING_MS, type Env } from "./env";
import { HttpError, json, noContent, parseJson } from "./http";
import { cancelSubscription, updateSubscriptionAccount } from "./stripe";

export type Status = "active" | "past_due" | "lifetime" | "lapsed";

export type AccountRow = {
  account_id: string;
  status: Status;
  plan: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  paid_through: number | null;
  lapsed_at: number | null;
  created_at: number;
  updated_at: number;
  seq: number;
  purged_seq: number;
};

export const LIFETIME_PLAN = "supporter_30_lifetime";

/** Supporters can write; a lapsed account is read-only (SY-65, SY-66). */
export const canWrite = (status: Status) => status === "active" || status === "past_due" || status === "lifetime";

export const getAccount = (db: D1Database, accountId: string) =>
  db.prepare("SELECT * FROM accounts WHERE account_id = ?").bind(accountId).first<AccountRow>();

/** The caller's account, or 402 if there is none (never paid, or purged). */
export const requireAccount = async (env: Env, caller: Caller): Promise<AccountRow> => {
  const account = await getAccount(env.DB, caller.accountId);
  if (!account) throw new HttpError(402, "not_supporter");
  return account;
};

export const requireWritable = async (env: Env, caller: Caller): Promise<AccountRow> => {
  const account = await requireAccount(env, caller);
  if (!canWrite(account.status)) throw new HttpError(402, "read_only");
  return account;
};

export const usage = async (db: D1Database, accountId: string) => {
  const row = await db
    .prepare("SELECT COUNT(*) AS menus, COALESCE(SUM(size), 0) AS bytes FROM menus WHERE account_id = ? AND deleted = 0")
    .bind(accountId)
    .first<{ menus: number; bytes: number }>();
  return { menus: row?.menus ?? 0, bytes: row?.bytes ?? 0 };
};

/** GET /v1/account */
export const getAccountStatus = async (env: Env, caller: Caller): Promise<Response> => {
  const limits = { menus: LIMITS.menus, menuBytes: LIMITS.menuBytes, totalBytes: LIMITS.totalBytes };
  const account = await getAccount(env.DB, caller.accountId);
  if (!account) {
    return json({ status: "none", plan: null, readOnly: true, limits, usage: { menus: 0, bytes: 0 } });
  }
  const purgeAt = account.status === "lapsed" && account.lapsed_at !== null ? account.lapsed_at + PURGE_AFTER_MS : null;
  return json({
    status: account.status,
    plan: account.plan,
    renewsAt: account.status === "lifetime" ? null : account.paid_through,
    readOnly: !canWrite(account.status),
    lapsedAt: account.lapsed_at,
    purgeAt,
    // SY-67: the app shows a stronger warning in the last 30 days.
    purgeSoon: purgeAt !== null && purgeAt - Date.now() <= PURGE_WARNING_MS,
    limits,
    usage: await usage(env.DB, caller.accountId),
  });
};

/** DELETE /v1/account (SY-68): cancel billing, then delete every synced menu and the account. */
export const deleteAccount = async (env: Env, caller: Caller): Promise<Response> => {
  const account = await getAccount(env.DB, caller.accountId);
  if (!account) return noContent();
  if (account.stripe_subscription_id && account.status !== "lapsed" && account.status !== "lifetime") {
    // Stop future charges first. If Stripe fails, keep the data so the user can retry.
    await cancelSubscription(env, account.stripe_subscription_id);
  }
  await env.DB.batch([
    env.DB.prepare("DELETE FROM menus WHERE account_id = ?").bind(caller.accountId),
    env.DB.prepare("DELETE FROM accounts WHERE account_id = ?").bind(caller.accountId),
  ]);
  return noContent();
};

/** The message a new key signs to prove the rotating device holds it (SY-8). */
export const rotationMessage = (oldAccountId: string, newAccountId: string, ts: number) =>
  [PROTOCOL, "rotate", oldAccountId, newAccountId, String(ts)].join("\n");

/**
 * POST /v1/account/rotate (SY-8). Body: { key, proof }. Signed by the old key; `proof`
 * is the new key's signature over rotationMessage(). Moves the supporter status to
 * the new account and deletes the old account's synced data; the device then
 * uploads its menus again under the new code.
 */
export const rotateAccount = async (env: Env, caller: Caller, body: Uint8Array): Promise<Response> => {
  const account = await requireAccount(env, caller);
  const input = parseJson(body);
  const newKey = typeof input.key === "string" ? fromBase64Url(input.key) : null;
  const proof = typeof input.proof === "string" ? fromBase64Url(input.proof) : null;
  if (newKey?.length !== 32 || proof?.length !== 64) throw new HttpError(400, "bad_request");
  const newAccountId = await accountIdForKey(newKey);
  if (newAccountId === caller.accountId) throw new HttpError(400, "bad_request");
  if (!(await verifyEd25519(newKey, proof, utf8(rotationMessage(caller.accountId, newAccountId, caller.ts))))) {
    throw new HttpError(401, "unauthorized");
  }
  if (await getAccount(env.DB, newAccountId)) throw new HttpError(409, "account_exists");
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO accounts (account_id, status, plan, stripe_customer_id, stripe_subscription_id,
         paid_through, lapsed_at, created_at, updated_at, seq, purged_seq)
       SELECT ?2, status, plan, stripe_customer_id, stripe_subscription_id, paid_through, lapsed_at,
         created_at, ?3, 0, 0 FROM accounts WHERE account_id = ?1`
    ).bind(caller.accountId, newAccountId, now),
    env.DB.prepare("DELETE FROM menus WHERE account_id = ?").bind(caller.accountId),
    env.DB.prepare("DELETE FROM accounts WHERE account_id = ?").bind(caller.accountId),
  ]);
  if (account.stripe_subscription_id) {
    // Best effort: webhooks also find the account by subscription id.
    await updateSubscriptionAccount(env, account.stripe_subscription_id, newAccountId).catch(() => undefined);
  }
  return json({ accountId: newAccountId });
};
