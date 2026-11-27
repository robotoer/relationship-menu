import { describe, expect, it } from "vitest";
import { fromBase64Url } from "../src/bytes";
import { LIMITS } from "../src/env";
import { createMenu, env, newId, record, seedAccount, supporter, Device } from "./helpers";

type ListBody = {
  menus: { id: string; version: number; seq: number; deleted: boolean; ciphertext: string }[];
  next: number;
  more: boolean;
  resync: boolean;
};

describe("SY-40: routing", () => {
  it("answers 404 for unknown paths and 405 for wrong methods", async () => {
    const device = await supporter();
    expect((await device.fetch("GET", "/v1/nope")).status).toBe(404);
    const wrong = await device.fetch("POST", "/v1/menus");
    expect(wrong.status).toBe(405);
    expect(wrong.headers.get("allow")).toBe("DELETE, GET");
  });

  it("serves a health check without auth or D1 (SY-46)", async () => {
    const response = await (await import("./helpers")).unsigned("GET", "/v1/health");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
  });
});

describe("SY-22, SY-42: conditional writes of opaque records", () => {
  it("creates with If-None-Match: *, then updates with If-Match on the current version", async () => {
    const device = await supporter();
    const first = record(300);
    const { id, response, body } = await createMenu(device, first);
    expect(response.status).toBe(200);
    expect(body.version).toBe(1);

    const second = record(400);
    const update = await device.fetch("PUT", `/v1/menus/${id}`, { body: second, headers: { "if-match": '"1"' } });
    expect(update.status).toBe(200);
    expect(await update.json()).toMatchObject({ version: 2 });

    // Stored byte for byte, as opaque ciphertext.
    const list = (await (await device.fetch("GET", "/v1/menus?since=0")).json()) as ListBody;
    expect(list.menus).toHaveLength(1);
    expect(fromBase64Url(list.menus[0]!.ciphertext)).toEqual(second);
  });

  it("refuses a write with no precondition (428)", async () => {
    const device = await supporter();
    const response = await device.fetch("PUT", `/v1/menus/${newId()}`, { body: record() });
    expect(response.status).toBe(428);
  });

  it("answers 412 with the current record on a version mismatch, and changes nothing", async () => {
    const device = await supporter();
    const { id } = await createMenu(device);
    await device.fetch("PUT", `/v1/menus/${id}`, { body: record(), headers: { "if-match": "1" } });
    const before = await env.DB.prepare("SELECT seq FROM accounts WHERE account_id = ?").bind(device.accountId).first<{ seq: number }>();

    const stale = await device.fetch("PUT", `/v1/menus/${id}`, { body: record(), headers: { "if-match": "1" } });
    expect(stale.status).toBe(412);
    const body = (await stale.json()) as { error: string; current: { version: number } };
    expect(body.error).toBe("version_mismatch");
    expect(body.current.version).toBe(2);

    const after = await env.DB.prepare("SELECT seq FROM accounts WHERE account_id = ?").bind(device.accountId).first<{ seq: number }>();
    expect(after?.seq).toBe(before?.seq);
  });

  it("refuses to create a menu that already exists", async () => {
    const device = await supporter();
    const { id } = await createMenu(device);
    const again = await device.fetch("PUT", `/v1/menus/${id}`, { body: record(), headers: { "if-none-match": "*" } });
    expect(again.status).toBe(412);
  });

  it("rejects malformed menu ids and records too short to be ciphertext", async () => {
    const device = await supporter();
    expect((await device.fetch("PUT", "/v1/menus/not-an-id", { body: record(), headers: { "if-none-match": "*" } })).status).toBe(400);
    expect((await device.fetch("PUT", `/v1/menus/${newId()}`, { body: record(10), headers: { "if-none-match": "*" } })).status).toBe(400);
  });
});

describe("SY-7: replayed writes fail the version check", () => {
  it("rejects a replayed PUT and a replayed DELETE", async () => {
    const device = await supporter();
    const { id } = await createMenu(device);
    const body = record();
    const ts = Math.floor(Date.now() / 1000);
    const first = await device.fetch("PUT", `/v1/menus/${id}`, { body, headers: { "if-match": "1" }, ts });
    expect(first.status).toBe(200);
    const replay = await device.fetch("PUT", `/v1/menus/${id}`, { body, headers: { "if-match": "1" }, ts });
    expect(replay.status).toBe(412);

    const tombstone = record(1052);
    const del = await device.fetch("DELETE", `/v1/menus/${id}`, { body: tombstone, headers: { "if-match": "2" }, ts });
    expect(del.status).toBe(200);
    const delReplay = await device.fetch("DELETE", `/v1/menus/${id}`, { body: tombstone, headers: { "if-match": "2" }, ts });
    expect(delReplay.status).toBe(412);
  });
});

describe("SY-19: deletions are encrypted tombstones", () => {
  it("stores the tombstone ciphertext with deleted=true, and a later PUT can bring the menu back (SY-36)", async () => {
    const device = await supporter();
    const { id } = await createMenu(device);
    const tombstone = record(1052);
    const del = await device.fetch("DELETE", `/v1/menus/${id}`, { body: tombstone, headers: { "if-match": "1" } });
    expect(await del.json()).toMatchObject({ version: 2 });

    let list = (await (await device.fetch("GET", "/v1/menus?since=0")).json()) as ListBody;
    expect(list.menus[0]).toMatchObject({ id, deleted: true, version: 2 });
    expect(fromBase64Url(list.menus[0]!.ciphertext)).toEqual(tombstone);

    const back = await device.fetch("PUT", `/v1/menus/${id}`, { body: record(), headers: { "if-match": "2" } });
    expect(back.status).toBe(200);
    list = (await (await device.fetch("GET", "/v1/menus?since=0")).json()) as ListBody;
    expect(list.menus[0]).toMatchObject({ id, deleted: false, version: 3 });
  });

  it("requires If-Match on DELETE", async () => {
    const device = await supporter();
    const { id } = await createMenu(device);
    expect((await device.fetch("DELETE", `/v1/menus/${id}`, { body: record(1052) })).status).toBe(428);
  });
});

describe("SY-32: pulling changes since a cursor", () => {
  it("returns changes after `since` in write order, 100 per page", async () => {
    const device = await supporter();
    const ids: string[] = [];
    for (let i = 0; i < 105; i++) ids.push((await createMenu(device, record(40))).id);

    const page1 = (await (await device.fetch("GET", "/v1/menus?since=0")).json()) as ListBody;
    expect(page1.menus).toHaveLength(100);
    expect(page1.more).toBe(true);
    expect(page1.menus.map((m) => m.id)).toEqual(ids.slice(0, 100));

    const page2 = (await (await device.fetch("GET", `/v1/menus?since=${page1.next}`)).json()) as ListBody;
    expect(page2.menus.map((m) => m.id)).toEqual(ids.slice(100));
    expect(page2.more).toBe(false);

    const empty = (await (await device.fetch("GET", `/v1/menus?since=${page2.next}`)).json()) as ListBody;
    expect(empty).toMatchObject({ menus: [], next: page2.next, more: false });
  });

  it("an update moves the menu after the cursor", async () => {
    const device = await supporter();
    const a = await createMenu(device);
    await createMenu(device);
    const cursor = ((await (await device.fetch("GET", "/v1/menus?since=0")).json()) as ListBody).next;
    await device.fetch("PUT", `/v1/menus/${a.id}`, { body: record(), headers: { "if-match": "1" } });
    const changes = (await (await device.fetch("GET", `/v1/menus?since=${cursor}`)).json()) as ListBody;
    expect(changes.menus.map((m) => m.id)).toEqual([a.id]);
  });

  it("keeps each account's records to itself", async () => {
    const alice = await supporter();
    const bob = await supporter();
    await createMenu(alice);
    const list = (await (await bob.fetch("GET", "/v1/menus?since=0")).json()) as ListBody;
    expect(list.menus).toEqual([]);
  });
});

describe("SY-23: quotas", () => {
  it("refuses a record over 64 KiB with 413", async () => {
    const device = await supporter();
    const response = await device.fetch("PUT", `/v1/menus/${newId()}`, {
      body: record(LIMITS.menuBytes + 1),
      headers: { "if-none-match": "*" },
    });
    expect(response.status).toBe(413);
  });

  it("refuses the 501st live menu with 507, but tombstones don't count", async () => {
    const device = await supporter();
    const now = Date.now();
    // Seed 500 live menus directly (fast), then try one more through the API.
    const statements = [];
    for (let i = 0; i < LIMITS.menus; i++) {
      statements.push(
        env.DB.prepare(
          "INSERT INTO menus (account_id, menu_id, version, seq, updated_at, deleted, size, ciphertext) VALUES (?, ?, 1, ?, ?, 0, 40, ?)"
        ).bind(device.accountId, newId(), i + 1, now, record(40))
      );
    }
    await env.DB.batch(statements);
    const over = await device.fetch("PUT", `/v1/menus/${newId()}`, { body: record(), headers: { "if-none-match": "*" } });
    expect(over.status).toBe(507);

    // Deleting one frees a slot.
    const victim = await env.DB.prepare("SELECT menu_id FROM menus WHERE account_id = ? LIMIT 1").bind(device.accountId).first<{ menu_id: string }>();
    const del = await device.fetch("DELETE", `/v1/menus/${victim!.menu_id}`, { body: record(1052), headers: { "if-match": "1" } });
    expect(del.status).toBe(200);
    const fits = await device.fetch("PUT", `/v1/menus/${newId()}`, { body: record(), headers: { "if-none-match": "*" } });
    expect(fits.status).toBe(200);
  });

  it("refuses a write that would pass 4 MiB in total", async () => {
    const device = await supporter();
    for (let i = 0; i < 64; i++) {
      const { response } = await createMenu(device, record(LIMITS.menuBytes));
      expect(response.status).toBe(200);
    }
    const over = await device.fetch("PUT", `/v1/menus/${newId()}`, { body: record(), headers: { "if-none-match": "*" } });
    expect(over.status).toBe(507);
  });
});

describe("SY-65, SY-66: who can read and write", () => {
  it("lets a past_due supporter keep syncing", async () => {
    const device = await supporter("past_due");
    const { response } = await createMenu(device);
    expect(response.status).toBe(200);
  });

  it("makes a lapsed account read-only", async () => {
    const device = await Device.create();
    await seedAccount(device.accountId, "active");
    const { id } = await createMenu(device);
    await env.DB.prepare("UPDATE accounts SET status = 'lapsed', lapsed_at = ? WHERE account_id = ?").bind(Date.now(), device.accountId).run();

    expect((await device.fetch("GET", "/v1/menus?since=0")).status).toBe(200);
    const write = await device.fetch("PUT", `/v1/menus/${id}`, { body: record(), headers: { "if-match": "1" } });
    expect(write.status).toBe(402);
    expect(await write.json()).toEqual({ error: "read_only" });
  });

  it("refuses reads and writes for a code with no supporter account", async () => {
    const device = await Device.create();
    expect((await device.fetch("GET", "/v1/menus?since=0")).status).toBe(402);
    const write = await device.fetch("PUT", `/v1/menus/${newId()}`, { body: record(), headers: { "if-none-match": "*" } });
    expect(write.status).toBe(402);
    expect(await write.json()).toEqual({ error: "not_supporter" });
  });
});
