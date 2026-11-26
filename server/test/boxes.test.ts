/**
 * Live-sharing boxes: docs/spec/notifications.md §2, §3 and the wire protocol
 * in §7a. `BoxDevice` (helpers.ts) is the reference for the app's signing.
 */

import { createExecutionContext, createScheduledController, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { rotationMessage } from "../src/accounts";
import { fromBase64Url, sha256, toBase64Url, toHex, utf8 } from "../src/bytes";
import { BOX_LIMITS, DAY_MS, INVITE_TTL_MS, type Env } from "../src/env";
import worker from "../src/index";
import { BoxDevice, Device, call, env, newId, record, seedAccount, shareLive, supporter, unsigned } from "./helpers";

afterEach(() => vi.restoreAllMocks());

type CopiesBody = {
  copies: { memberId: string; version: number; seq: number; updatedAt: number; ciphertext: string }[];
  seq: number;
  readOnly: boolean;
  members: number;
};

const count = async (sql: string, ...values: unknown[]) =>
  (await env.DB.prepare(sql).bind(...values).first<{ n: number }>())?.n ?? 0;

const boxRow = (boxId: string) =>
  env.DB.prepare("SELECT * FROM boxes WHERE box_id = ?").bind(boxId).first<Record<string, unknown>>();

const copies = async (device: BoxDevice, boxId: string, since = 0) => {
  const response = await device.fetch("GET", `/v1/boxes/${boxId}/copies?since=${since}`);
  expect(response.status).toBe(200);
  return (await response.json()) as CopiesBody;
};

/** A supporter's box with the host's device, plus `guests` joined devices. */
const liveBox = async (guests = 0, status: "active" | "past_due" | "lifetime" = "active") => {
  const account = await supporter(status);
  const box = await shareLive(account);
  expect(box.response.status).toBe(201);
  const members: BoxDevice[] = [];
  for (let i = 0; i < guests; i++) {
    const guest = await BoxDevice.create();
    expect((await guest.join(box.boxId, box.join)).status).toBe(201);
    members.push(guest);
  }
  return { account, ...box, members };
};

/**
 * Calls `send` until it's refused with 429, at most 2 × limit + 1 times. The
 * local limiter counts in fixed one-minute windows, so a test that crosses a
 * minute boundary may get up to twice the limit through.
 */
const untilLimited = async (limit: number, send: () => Promise<number>) => {
  const statuses: number[] = [];
  while (statuses.length < 2 * limit + 1 && statuses[statuses.length - 1] !== 429) statuses.push(await send());
  return statuses;
};

const expectLimited = (statuses: number[], limit: number, ok: number) => {
  expect(statuses[statuses.length - 1]).toBe(429);
  expect(statuses.length - 1).toBeGreaterThanOrEqual(limit);
  expect(statuses.slice(0, -1).every((s) => s === ok)).toBe(true);
};

const runCron = async () => {
  const ctx = createExecutionContext();
  await worker.scheduled(createScheduledController({ cron: "17 3 * * *", scheduledTime: Date.now() }), env, ctx);
  await waitOnExecutionContext(ctx);
};

const lapse = (accountId: string, lapsedAt = Date.now()) =>
  env.DB.prepare("UPDATE accounts SET status = 'lapsed', lapsed_at = ? WHERE account_id = ?").bind(lapsedAt, accountId).run();

describe("NT-50: routing", () => {
  it("answers 404 for unknown box paths and 405 for wrong methods", async () => {
    const { boxId, host } = await liveBox();
    expect((await host.fetch("GET", `/v1/boxes/${boxId}/nope`)).status).toBe(404);
    expect((await host.fetch("POST", `/v1/boxes/${boxId}/members/me/x`)).status).toBe(404);

    const list = await unsigned("GET", "/v1/boxes");
    expect(list.status).toBe(405);
    expect(list.headers.get("allow")).toBe("POST");
    const getBox = await host.fetch("GET", `/v1/boxes/${boxId}`);
    expect(getBox.status).toBe(405);
    expect(getBox.headers.get("allow")).toBe("DELETE");
    const getMembers = await unsigned("GET", `/v1/boxes/${boxId}/members`);
    expect(getMembers.status).toBe(405);
    expect(getMembers.headers.get("allow")).toBe("POST");
    expect((await host.fetch("POST", `/v1/boxes/${boxId}/copies`)).headers.get("allow")).toBe("GET");
  });

  it("answers 400 for box and member ids that aren't 22-character base64url", async () => {
    const { boxId, host, join } = await liveBox();
    expect((await host.fetch("GET", "/v1/boxes/short/copies?since=0")).status).toBe(400);
    expect((await host.fetch("DELETE", "/v1/boxes/short")).status).toBe(400);
    const guest = await BoxDevice.create();
    const badJoin = await guest.join("not-an-id", join);
    expect(badJoin.status).toBe(400);
    expect(await badJoin.json()).toEqual({ error: "bad_request" });
    const badMember = await host.fetch("PUT", `/v1/boxes/${boxId}/copies/nope`, { body: record(100), headers: { "if-none-match": "*" } });
    expect(badMember.status).toBe(400);
    expect(await badMember.json()).toEqual({ error: "bad_request" });
  });
});

describe("POST /v1/boxes: Share live (NT-1, NT-10)", () => {
  it("creates the box with the host's device as its first member, and stores only SHA-256(J)", async () => {
    const account = await supporter();
    const before = Date.now();
    const { boxId, join, host, response } = await shareLive(account);
    expect(response.status).toBe(201);
    const body = (await response.json()) as { boxId: string; memberId: string; inviteExpiresAt: number };
    expect(body.boxId).toBe(boxId);
    expect(body.memberId).toBe(host.memberId);
    expect(body.memberId).toBe(toBase64Url((await sha256(host.publicKey)).slice(0, 16)));
    expect(body.inviteExpiresAt).toBeGreaterThanOrEqual(before + INVITE_TTL_MS);
    expect(body.inviteExpiresAt).toBeLessThanOrEqual(Date.now() + INVITE_TTL_MS);

    const row = await boxRow(boxId);
    expect(row).toMatchObject({
      host_account: account.accountId,
      join_hash: toBase64Url(await sha256(join)),
      invite_expires_at: body.inviteExpiresAt,
      seq: 0,
    });
    // J itself is nowhere in the database.
    const dump = JSON.stringify(row);
    expect(dump).not.toContain(toBase64Url(join));
    expect(dump).not.toContain(toHex(join));

    const member = await env.DB.prepare("SELECT * FROM box_members WHERE box_id = ?").bind(boxId).all<Record<string, unknown>>();
    expect(member.results).toHaveLength(1);
    expect(member.results[0]).toMatchObject({ member_id: host.memberId, is_host: 1 });
    expect(new Uint8Array(member.results[0]!.public_key as ArrayBuffer)).toEqual(host.publicKey);

    expect(await copies(host, boxId)).toEqual({ copies: [], seq: 0, readOnly: false, members: 1 });
  });

  it("is for supporters: active, past due and lifetime can share; others get 402", async () => {
    for (const status of ["past_due", "lifetime"] as const) {
      expect((await shareLive(await supporter(status))).response.status).toBe(201);
    }
    const stranger = await Device.create();
    const none = (await shareLive(stranger)).response;
    expect(none.status).toBe(402);
    expect(await none.json()).toEqual({ error: "not_supporter" });

    const lapsed = await supporter("lapsed");
    const readOnly = (await shareLive(lapsed)).response;
    expect(readOnly.status).toBe(402);
    expect(await readOnly.json()).toEqual({ error: "read_only" });
  });

  it("needs a sync-account signature", async () => {
    const response = await unsigned("POST", "/v1/boxes", { body: JSON.stringify({ boxId: newId() }) });
    expect(response.status).toBe(401);
  });

  it("refuses an id that's taken (409 box_exists), even by the same account, and changes nothing", async () => {
    const account = await supporter();
    const first = await shareLive(account);
    const intruder = await BoxDevice.create();
    const again = await shareLive(account, { boxId: first.boxId, host: intruder });
    expect(again.response.status).toBe(409);
    expect(await again.response.json()).toEqual({ error: "box_exists" });
    const other = await shareLive(await supporter(), { boxId: first.boxId });
    expect(other.response.status).toBe(409);
    expect(await count("SELECT COUNT(*) AS n FROM box_members WHERE box_id = ?", first.boxId)).toBe(1);
    expect(await boxRow(first.boxId)).toMatchObject({ join_hash: toBase64Url(await sha256(first.join)) });
  });

  it("rejects malformed bodies", async () => {
    const key = toBase64Url((await BoxDevice.create()).publicKey);
    const hash = toBase64Url(record(32));
    for (const body of [
      {},
      { boxId: "short", joinHash: hash, hostKey: key },
      { boxId: newId(), joinHash: toBase64Url(record(31)), hostKey: key },
      { boxId: newId(), joinHash: hash, hostKey: toBase64Url(record(33)) },
      { boxId: newId(), joinHash: hash, hostKey: 5 },
      "not json",
    ]) {
      // A fresh account each time: creations are limited to 5 a minute (NT-52).
      const response = await (await supporter()).fetch("POST", "/v1/boxes", { body });
      expect(response.status).toBe(400);
    }
  });

  it("NT-5: at most 50 boxes per account (429 too_many_boxes); stopping one frees a slot", async () => {
    const account = await supporter();
    const now = Date.now();
    await env.DB.batch(
      Array.from({ length: BOX_LIMITS.boxes - 1 }, () =>
        env.DB.prepare("INSERT INTO boxes (box_id, host_account, join_hash, invite_expires_at, seq, created_at) VALUES (?, ?, NULL, NULL, 0, ?)").bind(
          newId(),
          account.accountId,
          now
        )
      )
    );
    const fiftieth = await shareLive(account);
    expect(fiftieth.response.status).toBe(201);
    const over = await shareLive(account);
    expect(over.response.status).toBe(429);
    expect(await over.response.json()).toMatchObject({ error: "too_many_boxes" });
    expect(await boxRow(over.boxId)).toBeNull();
    expect(await count("SELECT COUNT(*) AS n FROM box_members WHERE box_id = ?", over.boxId)).toBe(0);

    expect((await fiftieth.host.fetch("DELETE", `/v1/boxes/${fiftieth.boxId}`)).status).toBe(204);
    expect((await shareLive(account)).response.status).toBe(201);
  });

  it("NT-52: at most 5 box creations a minute per account", async () => {
    const account = await supporter();
    expectLimited(await untilLimited(5, async () => (await shareLive(account)).response.status), 5, 201);
  });
});

describe("POST /v1/boxes/:id/members: joining (NT-12)", () => {
  it("admits a device with J, as base64url(SHA-256(key)[0..16]), and is idempotent", async () => {
    const { boxId, join, host } = await liveBox();
    const guest = await BoxDevice.create();
    const first = await guest.join(boxId, join);
    expect(first.status).toBe(201);
    expect(await first.json()).toEqual({ memberId: guest.memberId });
    const again = await guest.join(boxId, join);
    expect(again.status).toBe(201);
    expect(await again.json()).toEqual({ memberId: guest.memberId });
    // The host joining with its own key stays the host.
    expect((await host.join(boxId, join)).status).toBe(201);
    const rows = await env.DB.prepare("SELECT member_id, is_host FROM box_members WHERE box_id = ? ORDER BY is_host DESC").bind(boxId).all();
    expect(rows.results).toEqual([
      { member_id: host.memberId, is_host: 1 },
      { member_id: guest.memberId, is_host: 0 },
    ]);
    expect((await copies(guest, boxId)).members).toBe(2);
  });

  it("needs no account and stores no credential: just the public key", async () => {
    const { boxId, join } = await liveBox();
    const guest = await BoxDevice.create();
    await guest.join(boxId, join);
    const row = await env.DB.prepare("SELECT * FROM box_members WHERE box_id = ? AND member_id = ?").bind(boxId, guest.memberId).first<Record<string, unknown>>();
    expect(Object.keys(row!).sort()).toEqual(["box_id", "is_host", "joined_at", "member_id", "public_key"]);
  });

  it("answers 404 for an unknown box and 403 bad_join for a wrong J", async () => {
    const { boxId } = await liveBox();
    const guest = await BoxDevice.create();
    const unknown = await guest.join(newId(), record(32));
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ error: "not_found" });
    const wrong = await guest.join(boxId, record(32));
    expect(wrong.status).toBe(403);
    expect(await wrong.json()).toEqual({ error: "bad_join" });
    expect((await guest.fetch("GET", `/v1/boxes/${boxId}/copies?since=0`)).status).toBe(403);
  });

  it("rejects malformed bodies", async () => {
    const { boxId, join } = await liveBox();
    const guest = await BoxDevice.create();
    const post = (body: unknown) =>
      call(new Request(`https://sync.test/v1/boxes/${boxId}/members`, { method: "POST", body: JSON.stringify(body) }));
    expect((await post({ key: guest.key })).status).toBe(400);
    expect((await post({ join: toBase64Url(join) })).status).toBe(400);
    expect((await post({ key: toBase64Url(record(31)), join: toBase64Url(join) })).status).toBe(400);
    expect((await post({ key: guest.key, join: "not base64!" })).status).toBe(400);
    expect((await post({ key: guest.key, join: "" })).status).toBe(400);
  });

  it("NT-13: an invite works for 7 days (410 invite_expired after)", async () => {
    const { boxId, join } = await liveBox();
    await env.DB.prepare("UPDATE boxes SET invite_expires_at = ? WHERE box_id = ?").bind(Date.now() - 1, boxId).run();
    const guest = await BoxDevice.create();
    const late = await guest.join(boxId, join);
    expect(late.status).toBe(410);
    expect(await late.json()).toEqual({ error: "invite_expired" });
  });

  it("NT-5: at most 16 member devices (409 box_full), though members can still re-join", async () => {
    const { boxId, join, members } = await liveBox(BOX_LIMITS.members - 1);
    expect(await count("SELECT COUNT(*) AS n FROM box_members WHERE box_id = ?", boxId)).toBe(16);
    const late = await BoxDevice.create();
    const full = await late.join(boxId, join);
    expect(full.status).toBe(409);
    expect(await full.json()).toMatchObject({ error: "box_full" });
    expect((await members[0]!.join(boxId, join)).status).toBe(201);

    // When someone leaves, there's room again.
    expect((await members[1]!.fetch("DELETE", `/v1/boxes/${boxId}/members/me`)).status).toBe(204);
    expect((await late.join(boxId, join)).status).toBe(201);
  });

  it("NT-52: at most 10 joins a minute per IP, apart from pairing reads", async () => {
    const { boxId, join } = await liveBox();
    const guest = await BoxDevice.create();
    expectLimited(await untilLimited(10, async () => (await guest.join(boxId, join, "203.0.113.200")).status), 10, 201);
    // Pairing reads from the same address are counted separately.
    const pairing = await call(new Request(`https://sync.test/v1/pair/${newId()}`, { headers: { "cf-connecting-ip": "203.0.113.200" } }));
    expect(pairing.status).toBe(404);
  });
});

describe("POST /v1/boxes/:id/invite: a new invite (NT-13)", () => {
  it("replaces J for new joins, for 7 more days; people who joined stay", async () => {
    const { boxId, join, host, members } = await liveBox(1);
    const before = Date.now();
    const newJoin = record(32);
    const response = await host.fetch("POST", `/v1/boxes/${boxId}/invite`, { body: { joinHash: toBase64Url(await sha256(newJoin)) } });
    expect(response.status).toBe(200);
    const { inviteExpiresAt } = (await response.json()) as { inviteExpiresAt: number };
    expect(inviteExpiresAt).toBeGreaterThanOrEqual(before + INVITE_TTL_MS);
    expect(await boxRow(boxId)).toMatchObject({ join_hash: toBase64Url(await sha256(newJoin)), invite_expires_at: inviteExpiresAt });

    expect((await (await BoxDevice.create()).join(boxId, join)).status).toBe(403);
    expect((await (await BoxDevice.create()).join(boxId, newJoin)).status).toBe(201);
    expect((await members[0]!.fetch("GET", `/v1/boxes/${boxId}/copies?since=0`)).status).toBe(200);
  });

  it("also revives an expired invite", async () => {
    const { boxId, host } = await liveBox();
    await env.DB.prepare("UPDATE boxes SET join_hash = NULL, invite_expires_at = ? WHERE box_id = ?").bind(Date.now() - DAY_MS, boxId).run();
    const newJoin = record(32);
    await host.fetch("POST", `/v1/boxes/${boxId}/invite`, { body: { joinHash: toBase64Url(await sha256(newJoin)) } });
    expect((await (await BoxDevice.create()).join(boxId, newJoin)).status).toBe(201);
  });

  it("is for the host only (403 not_host), and needs a 32-byte hash", async () => {
    const { boxId, host, members } = await liveBox(1);
    const guest = await members[0]!.fetch("POST", `/v1/boxes/${boxId}/invite`, { body: { joinHash: toBase64Url(record(32)) } });
    expect(guest.status).toBe(403);
    expect(await guest.json()).toEqual({ error: "not_host" });
    expect((await host.fetch("POST", `/v1/boxes/${boxId}/invite`, { body: { joinHash: "x" } })).status).toBe(400);
  });
});

describe("GET and PUT copies (NT-2…NT-4)", () => {
  it("writes a first copy with If-None-Match: *, then updates it with If-Match, stored byte for byte", async () => {
    const { boxId, host, members } = await liveBox(1);
    const guest = members[0]!;
    const first = record(4124);
    const created = await host.putCopy(boxId, first);
    expect(created.status).toBe(200);
    expect(await created.json()).toEqual({ version: 1, seq: 1 });

    const guestCopy = record(8220);
    expect(await (await guest.putCopy(boxId, guestCopy)).json()).toEqual({ version: 1, seq: 2 });

    const second = record(4124);
    const updated = await host.putCopy(boxId, second, { version: 1 });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toEqual({ version: 2, seq: 3 });

    const all = await copies(guest, boxId);
    expect(all.seq).toBe(3);
    expect(all.readOnly).toBe(false);
    expect(all.members).toBe(2);
    expect(all.copies.map((c) => [c.memberId, c.version, c.seq])).toEqual([
      [guest.memberId, 1, 2],
      [host.memberId, 2, 3],
    ]);
    expect(fromBase64Url(all.copies[1]!.ciphertext)).toEqual(second);
    expect(fromBase64Url(all.copies[0]!.ciphertext)).toEqual(guestCopy);
    expect(all.copies[1]!.updatedAt).toBeGreaterThan(0);
  });

  it("returns only the copies changed after `since`", async () => {
    const { boxId, host, members } = await liveBox(1);
    await host.putCopy(boxId, record(100));
    await members[0]!.putCopy(boxId, record(100));
    const cursor = (await copies(host, boxId)).seq;
    expect(await copies(host, boxId, cursor)).toEqual({ copies: [], seq: cursor, readOnly: false, members: 2 });
    await host.putCopy(boxId, record(100), { version: 1 });
    const changed = await copies(members[0]!, boxId, cursor);
    expect(changed.copies.map((c) => c.memberId)).toEqual([host.memberId]);
    expect(changed.seq).toBe(cursor + 1);
    // No `since` means everything.
    expect(((await (await host.fetch("GET", `/v1/boxes/${boxId}/copies`)).json()) as CopiesBody).copies).toHaveLength(2);
    expect((await host.fetch("GET", `/v1/boxes/${boxId}/copies?since=-1`)).status).toBe(400);
    expect((await host.fetch("GET", `/v1/boxes/${boxId}/copies?since=abc`)).status).toBe(400);
  });

  it("keeps each box's copies to itself", async () => {
    const a = await liveBox();
    const b = await liveBox();
    await a.host.putCopy(a.boxId, record(100));
    expect((await copies(b.host, b.boxId)).copies).toEqual([]);
    // A member of one box isn't a member of another.
    expect((await a.host.fetch("GET", `/v1/boxes/${b.boxId}/copies?since=0`)).status).toBe(403);
  });

  it("lets a member write only its own copy (403 not_yours)", async () => {
    const { boxId, host, members } = await liveBox(1);
    const response = await members[0]!.fetch("PUT", `/v1/boxes/${boxId}/copies/${host.memberId}`, {
      body: record(100),
      headers: { "if-none-match": "*" },
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "not_yours" });
  });

  it("refuses a write with no precondition (428)", async () => {
    const { boxId, host } = await liveBox();
    const response = await host.fetch("PUT", `/v1/boxes/${boxId}/copies/${host.memberId}`, { body: record(100) });
    expect(response.status).toBe(428);
    expect(await response.json()).toEqual({ error: "precondition_required" });
  });

  it("answers 412 version_mismatch with the current version, and changes nothing", async () => {
    const { boxId, host } = await liveBox();
    await host.putCopy(boxId, record(100));
    await host.putCopy(boxId, record(100), { version: 1 });
    const before = await boxRow(boxId);

    const stale = await host.putCopy(boxId, record(100), { version: 1 });
    expect(stale.status).toBe(412);
    expect(await stale.json()).toEqual({ error: "version_mismatch", current: { version: 2 } });
    const exists = await host.putCopy(boxId, record(100));
    expect(exists.status).toBe(412);
    expect(await exists.json()).toEqual({ error: "version_mismatch", current: { version: 2 } });
    expect(await boxRow(boxId)).toEqual(before);

    // If-Match on a copy that doesn't exist yet: there's no current version.
    const fresh = await liveBox();
    const none = await fresh.host.putCopy(fresh.boxId, record(100), { version: 1 });
    expect(none.status).toBe(412);
    expect(await none.json()).toEqual({ error: "version_mismatch", current: null });
  });

  it("NT-3 / SY-7: a replayed write fails the version check", async () => {
    const { boxId, host } = await liveBox();
    const body = record(200);
    const ts = Math.floor(Date.now() / 1000);
    const path = `/v1/boxes/${boxId}/copies/${host.memberId}`;
    const first = await host.fetch("PUT", path, { body, headers: { "if-none-match": "*" }, ts });
    expect(first.status).toBe(200);
    expect((await host.fetch("PUT", path, { body, headers: { "if-none-match": "*" }, ts })).status).toBe(412);
    const update = await host.fetch("PUT", path, { body, headers: { "if-match": '"1"' }, ts });
    expect(update.status).toBe(200);
    expect((await host.fetch("PUT", path, { body, headers: { "if-match": '"1"' }, ts })).status).toBe(412);
  });

  it("NT-5: copies are 28 B to 256 KiB", async () => {
    const { boxId, host, members } = await liveBox(1);
    expect((await host.putCopy(boxId, record(27))).status).toBe(400);
    expect((await host.putCopy(boxId, record(28))).status).toBe(200);
    const tooBig = await members[0]!.putCopy(boxId, record(BOX_LIMITS.copyBytes + 1));
    expect(tooBig.status).toBe(413);
    expect((await members[0]!.putCopy(boxId, record(BOX_LIMITS.copyBytes))).status).toBe(200);
    expect(await count("SELECT size AS n FROM box_copies WHERE box_id = ? AND member_id = ?", boxId, members[0]!.memberId)).toBe(
      BOX_LIMITS.copyBytes
    );
  });

  it("accepts and ignores a Notify header (phase 3)", async () => {
    const { boxId, host } = await liveBox();
    expect((await host.putCopy(boxId, record(100), {}, { notify: "comment" })).status).toBe(200);
    expect((await host.putCopy(boxId, record(100), { version: 1 }, { notify: "notes" })).status).toBe(200);
    expect((await host.putCopy(boxId, record(100), { version: 2 }, { notify: "anything" })).status).toBe(200);
  });

  it("doesn't count against the menus quota", async () => {
    const { account, boxId, host } = await liveBox();
    await host.putCopy(boxId, record(BOX_LIMITS.copyBytes));
    const status = (await (await account.fetch("GET", "/v1/account")).json()) as { usage: { menus: number; bytes: number } };
    expect(status.usage).toEqual({ menus: 0, bytes: 0 });
  });
});

describe("NT-12: member requests are signed with the box key", () => {
  it("rejects a request with no or the wrong kind of Authorization header", async () => {
    const { account, boxId } = await liveBox();
    const none = await unsigned("GET", `/v1/boxes/${boxId}/copies?since=0`);
    expect(none.status).toBe(401);
    expect(await none.json()).toEqual({ error: "unauthorized" });
    // A sync-account signature isn't a box signature.
    expect((await account.fetch("GET", `/v1/boxes/${boxId}/copies?since=0`)).status).toBe(401);
  });

  it("rejects a signature made with a different key", async () => {
    const { boxId, host } = await liveBox();
    const other = await BoxDevice.create();
    const header = await other.authorization("GET", `/v1/boxes/${boxId}/copies`, boxId, new Uint8Array());
    const forged = header.replace(/key=[^,]+/, `key=${host.key}`);
    const response = await call(new Request(`https://sync.test/v1/boxes/${boxId}/copies`, { headers: { authorization: forged } }));
    expect(response.status).toBe(401);
  });

  it("rejects a header naming another box than the path", async () => {
    const a = await liveBox();
    const b = await liveBox();
    // Signed correctly, but for box B while asking for box A.
    expect((await a.host.fetch("GET", `/v1/boxes/${a.boxId}/copies`, { boxId: b.boxId })).status).toBe(401);
    // A signature for one box's path doesn't work for another's.
    const header = await a.host.authorization("GET", `/v1/boxes/${a.boxId}/copies`, a.boxId, new Uint8Array());
    const moved = await call(
      new Request(`https://sync.test/v1/boxes/${b.boxId}/copies`, { headers: { authorization: header.replace(a.boxId, b.boxId) } })
    );
    expect(moved.status).toBe(401);
  });

  it("binds the signature to the method, path, query and body", async () => {
    const { boxId, host } = await liveBox();
    const header = await host.authorization("GET", `/v1/boxes/${boxId}/copies?since=0`, boxId, new Uint8Array());
    const otherQuery = await call(new Request(`https://sync.test/v1/boxes/${boxId}/copies?since=5`, { headers: { authorization: header } }));
    expect(otherQuery.status).toBe(401);
    const path = `/v1/boxes/${boxId}/copies/${host.memberId}`;
    const putHeader = await host.authorization("PUT", path, boxId, record(100));
    const swapped = await call(
      new Request(`https://sync.test${path}`, { method: "PUT", headers: { authorization: putHeader, "if-none-match": "*" }, body: record(100) })
    );
    expect(swapped.status).toBe(401);
    // The label is part of it: a menu-sync/v1 signature under a MenuBox header fails.
    const device = await Device.create();
    const syncHeader = await device.authorization("GET", `/v1/boxes/${boxId}/copies`, new Uint8Array());
    const sig = syncHeader.match(/sig=(.+)$/)![1];
    const relabelled = (await host.authorization("GET", `/v1/boxes/${boxId}/copies`, boxId, new Uint8Array())).replace(/sig=.+$/, `sig=${sig}`);
    expect((await call(new Request(`https://sync.test/v1/boxes/${boxId}/copies`, { headers: { authorization: relabelled } }))).status).toBe(401);
  });

  it("rejects timestamps more than 5 minutes off", async () => {
    const { boxId, host } = await liveBox();
    const now = Math.floor(Date.now() / 1000);
    const late = await host.fetch("GET", `/v1/boxes/${boxId}/copies`, { ts: now - 301 });
    expect(late.status).toBe(401);
    expect(await late.json()).toEqual({ error: "clock_skew" });
    expect((await host.fetch("GET", `/v1/boxes/${boxId}/copies`, { ts: now + 301 })).status).toBe(401);
    expect((await host.fetch("GET", `/v1/boxes/${boxId}/copies`, { ts: now - 299 })).status).toBe(200);
  });

  it("answers 403 not_member for a key that isn't a member, and 404 for an unknown box", async () => {
    const { boxId } = await liveBox();
    const stranger = await BoxDevice.create();
    const response = await stranger.putCopy(boxId, record(100));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "not_member" });
    const unknown = await stranger.fetch("GET", `/v1/boxes/${newId()}/copies`);
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ error: "not_found" });
  });

  it("NT-52: limits box requests per member device", async () => {
    const { boxId, host, members } = await liveBox(1);
    const keys: string[] = [];
    const limiter = {
      limit: async ({ key }: { key: string }) => {
        keys.push(key);
        return { success: keys.filter((k) => k === key).length <= 2 };
      },
    } as unknown as RateLimit;
    const limited: Env = { ...env, RL_ACCOUNT: limiter };
    const path = `/v1/boxes/${boxId}/copies`;
    const statuses = [];
    for (let i = 0; i < 3; i++) statuses.push((await host.fetch("GET", path, { env: limited })).status);
    expect(statuses).toEqual([200, 200, 429]);
    // Another member of the same box has its own allowance.
    expect((await members[0]!.fetch("GET", path, { env: limited })).status).toBe(200);
    expect(new Set(keys).size).toBe(2);
    // Unsigned requests never reach the limiter (or D1).
    await call(new Request(`https://sync.test${path}`));
    expect(keys).toHaveLength(4);
  });
});

describe("Leaving and stopping (NT-14, NT-15)", () => {
  it("Leave deletes the device's copy and member entry; it's no longer a member", async () => {
    const { boxId, host, members } = await liveBox(1);
    const guest = members[0]!;
    await guest.putCopy(boxId, record(100));
    await host.putCopy(boxId, record(100));
    const left = await guest.fetch("DELETE", `/v1/boxes/${boxId}/members/me`);
    expect(left.status).toBe(204);
    expect(await count("SELECT COUNT(*) AS n FROM box_copies WHERE box_id = ? AND member_id = ?", boxId, guest.memberId)).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM box_members WHERE box_id = ? AND member_id = ?", boxId, guest.memberId)).toBe(0);
    expect((await guest.fetch("GET", `/v1/boxes/${boxId}/copies`)).status).toBe(403);
    expect((await guest.putCopy(boxId, record(100), { version: 1 })).status).toBe(403);
    const rest = await copies(host, boxId);
    expect(rest.members).toBe(1);
    expect(rest.copies.map((c) => c.memberId)).toEqual([host.memberId]);
  });

  it("the host can't leave (409 host_must_stop)", async () => {
    const { boxId, host } = await liveBox();
    const response = await host.fetch("DELETE", `/v1/boxes/${boxId}/members/me`);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "host_must_stop" });
  });

  it("Stop sharing (host only) deletes every copy and member; their next request gets 404", async () => {
    const { boxId, host, members } = await liveBox(2);
    for (const device of [host, ...members]) await device.putCopy(boxId, record(100));
    const notHost = await members[0]!.fetch("DELETE", `/v1/boxes/${boxId}`);
    expect(notHost.status).toBe(403);
    expect(await notHost.json()).toEqual({ error: "not_host" });

    expect((await host.fetch("DELETE", `/v1/boxes/${boxId}`)).status).toBe(204);
    expect(await boxRow(boxId)).toBeNull();
    expect(await count("SELECT COUNT(*) AS n FROM box_members WHERE box_id = ?", boxId)).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM box_copies WHERE box_id = ?", boxId)).toBe(0);
    for (const device of [host, ...members]) {
      expect((await device.fetch("GET", `/v1/boxes/${boxId}/copies`)).status).toBe(404);
    }
    expect((await members[0]!.putCopy(boxId, record(100), { version: 1 })).status).toBe(404);
  });
});

describe("NT-16: boxes follow the host's supporter status", () => {
  it("a lapsed host's box is read-only: members read (readOnly: true) but can't write or invite", async () => {
    const { account, boxId, host, members } = await liveBox(1);
    await host.putCopy(boxId, record(100));
    await lapse(account.accountId);

    const read = await copies(members[0]!, boxId);
    expect(read.readOnly).toBe(true);
    expect(read.copies).toHaveLength(1);
    for (const write of [members[0]!.putCopy(boxId, record(100)), host.putCopy(boxId, record(100), { version: 1 })]) {
      const response = await write;
      expect(response.status).toBe(402);
      expect(await response.json()).toEqual({ error: "read_only" });
    }
    const invite = await host.fetch("POST", `/v1/boxes/${boxId}/invite`, { body: { joinHash: toBase64Url(record(32)) } });
    expect(invite.status).toBe(402);
    // Leaving and stopping still work.
    expect((await members[0]!.fetch("DELETE", `/v1/boxes/${boxId}/members/me`)).status).toBe(204);
    expect((await host.fetch("DELETE", `/v1/boxes/${boxId}`)).status).toBe(204);
  });

  it("past due hosts keep writing; renewing makes the box writable again", async () => {
    const { account, boxId, host } = await liveBox(0, "past_due");
    expect((await host.putCopy(boxId, record(100))).status).toBe(200);
    await lapse(account.accountId);
    expect((await host.putCopy(boxId, record(100), { version: 1 })).status).toBe(402);
    await env.DB.prepare("UPDATE accounts SET status = 'active', lapsed_at = NULL WHERE account_id = ?").bind(account.accountId).run();
    expect((await host.putCopy(boxId, record(100), { version: 1 })).status).toBe(200);
  });

  it("deleting the account (SY-68) deletes the boxes it hosts, with members and copies, and nobody else's", async () => {
    const mine = await liveBox(1);
    const second = await shareLive(mine.account);
    await mine.host.putCopy(mine.boxId, record(100));
    await mine.members[0]!.putCopy(mine.boxId, record(100));
    const theirs = await liveBox(1);
    await theirs.host.putCopy(theirs.boxId, record(100));

    expect((await mine.account.fetch("DELETE", "/v1/account")).status).toBe(204);
    for (const boxId of [mine.boxId, second.boxId]) {
      expect(await boxRow(boxId)).toBeNull();
      expect(await count("SELECT COUNT(*) AS n FROM box_members WHERE box_id = ?", boxId)).toBe(0);
      expect(await count("SELECT COUNT(*) AS n FROM box_copies WHERE box_id = ?", boxId)).toBe(0);
    }
    expect((await mine.members[0]!.fetch("GET", `/v1/boxes/${mine.boxId}/copies`)).status).toBe(404);
    expect((await copies(theirs.members[0]!, theirs.boxId)).copies).toHaveLength(1);
  });

  it("rotating the sync code (SY-8) moves the boxes to the new account; they keep working", async () => {
    const oldDevice = await Device.create();
    await seedAccount(oldDevice.accountId, "active");
    const box = await shareLive(oldDevice);
    await box.host.putCopy(box.boxId, record(100));
    const newDevice = await Device.create();
    const ts = Math.floor(Date.now() / 1000);
    const proof = await newDevice.signBytes(utf8(rotationMessage(oldDevice.accountId, newDevice.accountId, ts)));
    const rotated = await oldDevice.fetch("POST", "/v1/account/rotate", {
      body: { key: toBase64Url(newDevice.publicKey), proof: toBase64Url(proof) },
      ts,
    });
    expect(rotated.status).toBe(200);

    expect(await boxRow(box.boxId)).toMatchObject({ host_account: newDevice.accountId });
    expect(await count("SELECT COUNT(*) AS n FROM boxes WHERE host_account = ?", oldDevice.accountId)).toBe(0);
    const read = await copies(box.host, box.boxId);
    expect(read).toMatchObject({ readOnly: false, members: 1 });
    expect(read.copies).toHaveLength(1);
    expect((await box.host.putCopy(box.boxId, record(100), { version: 1 })).status).toBe(200);
    // The old code can't make boxes any more; the new one can.
    expect((await shareLive(oldDevice)).response.status).toBe(402);
    expect((await shareLive(newDevice)).response.status).toBe(201);
  });
});

describe("NT-53: the daily cron", () => {
  it("clears expired join hashes and keeps current ones; members stay", async () => {
    const expired = await liveBox(1);
    const current = await liveBox();
    await env.DB.prepare("UPDATE boxes SET invite_expires_at = ? WHERE box_id = ?").bind(Date.now() - 1000, expired.boxId).run();

    await runCron();

    expect(await boxRow(expired.boxId)).toMatchObject({ join_hash: null });
    expect(await boxRow(current.boxId)).toMatchObject({ join_hash: toBase64Url(await sha256(current.join)) });
    expect((await (await BoxDevice.create()).join(expired.boxId, expired.join)).status).toBe(410);
    expect((await copies(expired.members[0]!, expired.boxId)).members).toBe(2);
  });

  it("purges the boxes of accounts purged after 12 months lapsed, and keeps the others", async () => {
    const purged = await liveBox(1);
    await purged.host.putCopy(purged.boxId, record(100));
    await lapse(purged.account.accountId, Date.now() - 366 * DAY_MS);
    const recent = await liveBox();
    await lapse(recent.account.accountId, Date.now() - 364 * DAY_MS);
    const active = await liveBox();

    await runCron();

    expect(await boxRow(purged.boxId)).toBeNull();
    expect(await count("SELECT COUNT(*) AS n FROM box_members WHERE box_id = ?", purged.boxId)).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM box_copies WHERE box_id = ?", purged.boxId)).toBe(0);
    expect(await boxRow(recent.boxId)).not.toBeNull();
    expect(await boxRow(active.boxId)).not.toBeNull();
  });
});

describe("NT-51 / SY-44: nothing identifying or secret reaches the logs", () => {
  it("logs only route patterns, statuses and codes through a full box flow, including failures", async () => {
    const MARKER = "ZqxSecretConversation";
    const lines: string[] = [];
    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        lines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
      });
    }
    const account = await supporter();
    const { boxId, join, host } = await shareLive(account);
    const guest = await BoxDevice.create();
    const ip = "203.0.113.99";
    await guest.join(boxId, join, ip);
    const ciphertext = record(400, MARKER);
    await host.putCopy(boxId, ciphertext);
    await guest.putCopy(boxId, ciphertext);
    await guest.putCopy(boxId, ciphertext, { version: 7 });
    await guest.fetch("PUT", `/v1/boxes/${boxId}/copies/${host.memberId}`, { body: ciphertext, headers: { "if-none-match": "*" } });
    await guest.putCopy(boxId, record(BOX_LIMITS.copyBytes + 1, MARKER), { version: 1 });
    await guest.fetch("GET", `/v1/boxes/${boxId}/copies?since=0`);
    await guest.fetch("GET", `/v1/boxes/${boxId}/copies`, { ts: 1 });
    await (await BoxDevice.create()).join(boxId, utf8(MARKER), ip);
    // Over the join limit for this address, and over the box limit: both are logged (429).
    for (let i = 0; i < 21; i++) await guest.join(boxId, join, ip);
    await env.DB.batch(
      Array.from({ length: BOX_LIMITS.boxes }, () =>
        env.DB.prepare("INSERT INTO boxes (box_id, host_account, seq, created_at) VALUES (?, ?, 0, 0)").bind(newId(), account.accountId)
      )
    );
    const over = await shareLive(account);
    await guest.fetch("DELETE", `/v1/boxes/${boxId}/members/me`);
    await host.fetch("DELETE", `/v1/boxes/${boxId}`);
    await runCron();

    const everything = lines.join("\n");
    expect(everything).toContain("too_many_boxes");
    expect(everything).toContain("rate_limited");
    for (const secret of [
      MARKER,
      toBase64Url(utf8(MARKER)),
      toHex(utf8(MARKER)),
      boxId,
      over.boxId,
      host.memberId,
      guest.memberId,
      host.key,
      guest.key,
      toBase64Url(join),
      toBase64Url(await sha256(join)),
      account.accountId,
      ip,
      "MenuBox v1",
    ]) {
      expect(everything).not.toContain(secret);
    }
    for (const line of lines) {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      expect(Object.keys(parsed)).toEqual(expect.arrayContaining(["route", "status", "code"]));
      expect(String(parsed.route)).not.toMatch(/[A-Za-z0-9_-]{22}/);
    }
  });
});
