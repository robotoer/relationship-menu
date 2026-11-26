import { createExecutionContext, createScheduledController, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { DAY_MS } from "../src/env";
import worker from "../src/index";
import { Device, accountRow, createMenu, env, newId, record, seedAccount, supporter } from "./helpers";

const runCron = async () => {
  const ctx = createExecutionContext();
  await worker.scheduled(createScheduledController({ cron: "17 3 * * *", scheduledTime: Date.now() }), env, ctx);
  await waitOnExecutionContext(ctx);
};

const menuCount = async (accountId: string) =>
  (await env.DB.prepare("SELECT COUNT(*) AS n FROM menus WHERE account_id = ?").bind(accountId).first<{ n: number }>())?.n;

describe("SY-67: purging lapsed accounts after 12 months", () => {
  it("deletes accounts lapsed over 365 days with their menus, and keeps everything else", async () => {
    const expired = await Device.create();
    await seedAccount(expired.accountId, "active");
    await createMenu(expired);
    await env.DB.prepare("UPDATE accounts SET status = 'lapsed', lapsed_at = ? WHERE account_id = ?")
      .bind(Date.now() - 366 * DAY_MS, expired.accountId)
      .run();

    const recent = await Device.create();
    await seedAccount(recent.accountId, "active");
    await createMenu(recent);
    await env.DB.prepare("UPDATE accounts SET status = 'lapsed', lapsed_at = ? WHERE account_id = ?")
      .bind(Date.now() - 364 * DAY_MS, recent.accountId)
      .run();

    const active = await supporter("active");
    await createMenu(active);
    const lifetime = await supporter("lifetime");

    await runCron();

    expect(await accountRow(expired.accountId)).toBeNull();
    expect(await menuCount(expired.accountId)).toBe(0);
    expect(await accountRow(recent.accountId)).not.toBeNull();
    expect(await menuCount(recent.accountId)).toBe(1);
    expect(await menuCount(active.accountId)).toBe(1);
    expect(await accountRow(lifetime.accountId)).not.toBeNull();
  });
});

describe("SY-23, SY-45: forgetting old tombstones, pairings and event ids", () => {
  it("drops tombstones over 180 days old and tells devices with older cursors to resync", async () => {
    const device = await supporter();
    const old = await createMenu(device);
    await device.fetch("DELETE", `/v1/menus/${old.id}`, { body: record(1052), headers: { "if-match": "1" } });
    const keep = await createMenu(device);
    // The tombstone is old; the live menu is too, but live menus never expire.
    await env.DB.prepare("UPDATE menus SET updated_at = ? WHERE account_id = ?").bind(Date.now() - 181 * DAY_MS, device.accountId).run();
    const tombstoneSeq = (await env.DB.prepare("SELECT seq FROM menus WHERE menu_id = ?").bind(old.id).first<{ seq: number }>())!.seq;

    await runCron();

    const ids = (await env.DB.prepare("SELECT menu_id FROM menus WHERE account_id = ?").bind(device.accountId).all<{ menu_id: string }>()).results.map((r) => r.menu_id);
    expect(ids).toEqual([keep.id]);
    expect(await accountRow(device.accountId)).toMatchObject({ purged_seq: tombstoneSeq });

    // A device whose cursor predates the forgotten tombstone must pull everything again.
    const stale = await device.fetch("GET", `/v1/menus?since=${tombstoneSeq - 1}`);
    expect(await stale.json()).toMatchObject({ resync: true, menus: [] });
    // A fresh pull works.
    const full = (await (await device.fetch("GET", "/v1/menus?since=0")).json()) as { resync: boolean; menus: unknown[] };
    expect(full.resync).toBe(false);
    expect(full.menus).toHaveLength(1);
  });

  it("deletes pairings a day after expiry and webhook ids after 30 days", async () => {
    const fresh = newId();
    const stale = newId();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO pairings (id, blob, expires_at) VALUES (?, ?, ?)").bind(fresh, record(10), Date.now() + 60_000),
      env.DB.prepare("INSERT INTO pairings (id, blob, expires_at) VALUES (?, ?, ?)").bind(stale, record(10), Date.now() - 2 * DAY_MS),
      env.DB.prepare("INSERT INTO stripe_events (event_id, received_at) VALUES (?, ?)").bind("evt_new", Date.now()),
      env.DB.prepare("INSERT INTO stripe_events (event_id, received_at) VALUES (?, ?)").bind("evt_old", Date.now() - 31 * DAY_MS),
    ]);
    await runCron();
    const pairings = (await env.DB.prepare("SELECT id FROM pairings").all<{ id: string }>()).results.map((r) => r.id);
    expect(pairings).toEqual([fresh]);
    const events = (await env.DB.prepare("SELECT event_id FROM stripe_events").all<{ event_id: string }>()).results.map((r) => r.event_id);
    expect(events).toEqual(["evt_new"]);
  });
});
