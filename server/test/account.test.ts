import { afterEach, describe, expect, it, vi } from "vitest";
import { rotationMessage } from "../src/accounts";
import { toBase64Url, utf8 } from "../src/bytes";
import { PURGE_AFTER_MS } from "../src/env";
import { Device, accountRow, createMenu, env, mockStripe, seedAccount, subscription, supporter } from "./helpers";

afterEach(() => vi.restoreAllMocks());

type AccountBody = {
  status: string;
  plan: string | null;
  readOnly: boolean;
  purgeAt: number | null;
  purgeSoon: boolean;
  limits: { menus: number; menuBytes: number; totalBytes: number };
  usage: { menus: number; bytes: number };
};

describe("GET /v1/account", () => {
  it("reports status, limits and usage (SY-23, SY-71)", async () => {
    const device = await supporter();
    await createMenu(device, new Uint8Array(500));
    const body = (await (await device.fetch("GET", "/v1/account")).json()) as AccountBody;
    expect(body).toMatchObject({
      status: "active",
      plan: "supporter_12_yearly",
      readOnly: false,
      limits: { menus: 500, menuBytes: 65536, totalBytes: 4194304 },
      usage: { menus: 1, bytes: 500 },
    });
  });

  it("shows when a lapsed account will be purged, and warns in the last 30 days (SY-66, SY-67)", async () => {
    const device = await Device.create();
    const lapsedAt = Date.now() - 340 * 24 * 3600 * 1000;
    await seedAccount(device.accountId, "lapsed", { lapsed_at: lapsedAt });
    const body = (await (await device.fetch("GET", "/v1/account")).json()) as AccountBody;
    expect(body).toMatchObject({ status: "lapsed", readOnly: true, purgeAt: lapsedAt + PURGE_AFTER_MS, purgeSoon: true });
  });
});

describe("SY-68: delete synced menus but keep the account", () => {
  it("deletes the content, advances the resync marker, and leaves status and billing alone", async () => {
    const device = await Device.create();
    await seedAccount(device.accountId, "lifetime");
    await createMenu(device);
    await createMenu(device);
    const before = await accountRow(device.accountId);
    const calls = mockStripe({});

    expect((await device.fetch("DELETE", "/v1/menus")).status).toBe(204);
    const after = await accountRow(device.accountId);
    expect(after).toMatchObject({ status: "lifetime", plan: "supporter_30_lifetime" });
    expect(Number(after?.purged_seq)).toBe(Number(before?.seq ?? 0) + 1);
    expect(after?.seq).toBe(after?.purged_seq);
    expect(calls).toEqual([]);
    const left = await env.DB.prepare("SELECT COUNT(*) AS n FROM menus WHERE account_id = ?").bind(device.accountId).first<{ n: number }>();
    expect(left?.n).toBe(0);
  });
});

describe("SY-68: delete everything", () => {
  it("cancels the subscription, then deletes every synced menu and the account", async () => {
    const device = await Device.create();
    await seedAccount(device.accountId, "active", { stripe_subscription_id: "sub_del", stripe_customer_id: "cus_del" });
    await createMenu(device);
    await createMenu(device);
    const calls = mockStripe({ "DELETE /v1/subscriptions/sub_del": () => subscription({ id: "sub_del", status: "canceled" }) });

    const response = await device.fetch("DELETE", "/v1/account");
    expect(response.status).toBe(204);
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(["DELETE /v1/subscriptions/sub_del"]);
    expect(await accountRow(device.accountId)).toBeNull();
    const left = await env.DB.prepare("SELECT COUNT(*) AS n FROM menus WHERE account_id = ?").bind(device.accountId).first<{ n: number }>();
    expect(left?.n).toBe(0);
  });

  it("keeps the data if Stripe can't cancel, so the user can retry", async () => {
    const device = await Device.create();
    await seedAccount(device.accountId, "active", { stripe_subscription_id: "sub_fail" });
    mockStripe({});
    const response = await device.fetch("DELETE", "/v1/account");
    expect(response.status).toBe(502);
    expect(await accountRow(device.accountId)).not.toBeNull();
  });

  it("doesn't call Stripe for a lifetime supporter", async () => {
    const device = await supporter("lifetime");
    const calls = mockStripe({});
    expect((await device.fetch("DELETE", "/v1/account")).status).toBe(204);
    expect(calls).toEqual([]);
  });
});

describe("SY-8: replacing the sync code", () => {
  const rotate = async (oldDevice: Device, newDevice: Device, proofOverride?: Uint8Array) => {
    const ts = Math.floor(Date.now() / 1000);
    const proof =
      proofOverride ?? (await newDevice.signBytes(utf8(rotationMessage(oldDevice.accountId, newDevice.accountId, ts))));
    return oldDevice.fetch("POST", "/v1/account/rotate", {
      body: { key: toBase64Url(newDevice.publicKey), proof: toBase64Url(proof) },
      ts,
    });
  };

  it("CO-8: the AI coach's use so far moves to the new code (a new code isn't a new allowance)", async () => {
    const oldDevice = await Device.create();
    await seedAccount(oldDevice.accountId, "active");
    await env.DB.batch([
      env.DB.prepare("INSERT INTO coach_usage (key, day, count) VALUES (?, '2026-11-26', 2)").bind(`a:${oldDevice.accountId}`),
      env.DB.prepare("INSERT INTO coach_usage (key, day, count) VALUES (?, '2026-11', 4)").bind(`m:a:${oldDevice.accountId}`),
    ]);
    const newDevice = await Device.create();
    expect((await rotate(oldDevice, newDevice)).status).toBe(200);
    const rows = await env.DB.prepare("SELECT key, day, count FROM coach_usage WHERE key LIKE ? OR key LIKE ? ORDER BY key")
      .bind(`%${oldDevice.accountId}`, `%${newDevice.accountId}`)
      .all<{ key: string; day: string; count: number }>();
    expect(rows.results).toEqual([
      { key: `a:${newDevice.accountId}`, day: "2026-11-26", count: 2 },
      { key: `m:a:${newDevice.accountId}`, day: "2026-11", count: 4 },
    ]);
  });

  it("refuses to move it at all once the request has taken too long (a device may have given up on it)", async () => {
    const oldDevice = await Device.create();
    await seedAccount(oldDevice.accountId, "active");
    await createMenu(oldDevice);
    const newDevice = await Device.create();
    const ts = Math.floor(Date.now() / 1000);
    const proof = await newDevice.signBytes(utf8(rotationMessage(oldDevice.accountId, newDevice.accountId, ts)));
    const response = await oldDevice.fetch("POST", "/v1/account/rotate", {
      body: { key: toBase64Url(newDevice.publicKey), proof: toBase64Url(proof) },
      ts,
      env: { ...env, ROTATION_COMMIT_MS: "-1" },
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "rotation_too_slow" });
    expect(await accountRow(oldDevice.accountId)).toMatchObject({ status: "active" });
    expect(await accountRow(newDevice.accountId)).toBeNull();
  });

  it("moves the supporter status to the new code and deletes the old account's data", async () => {
    const oldDevice = await Device.create();
    await seedAccount(oldDevice.accountId, "active", { stripe_subscription_id: "sub_rot", stripe_customer_id: "cus_rot" });
    await createMenu(oldDevice);
    const newDevice = await Device.create();
    const calls = mockStripe({ "POST /v1/subscriptions/sub_rot": () => subscription({ id: "sub_rot" }) });

    const response = await rotate(oldDevice, newDevice);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ accountId: newDevice.accountId });

    expect(await accountRow(oldDevice.accountId)).toBeNull();
    expect(await accountRow(newDevice.accountId)).toMatchObject({
      status: "active",
      stripe_subscription_id: "sub_rot",
      stripe_customer_id: "cus_rot",
      seq: 0,
    });
    // Old code: nothing left to read.
    expect((await oldDevice.fetch("GET", "/v1/menus?since=0")).status).toBe(402);
    // Stripe metadata follows the new account.
    expect(calls[0]?.params.get("metadata[account_id]")).toBe(newDevice.accountId);
  });

  it("refuses a proof not signed by the new key", async () => {
    const oldDevice = await supporter();
    const newDevice = await Device.create();
    const impostor = await Device.create();
    const ts = Math.floor(Date.now() / 1000);
    const badProof = await impostor.signBytes(utf8(rotationMessage(oldDevice.accountId, newDevice.accountId, ts)));
    const response = await rotate(oldDevice, newDevice, badProof);
    expect(response.status).toBe(401);
    expect(await accountRow(oldDevice.accountId)).not.toBeNull();
  });

  it("refuses to take over an account that already exists", async () => {
    const oldDevice = await supporter();
    const newDevice = await supporter();
    expect((await rotate(oldDevice, newDevice)).status).toBe(409);
  });
});
