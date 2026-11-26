/**
 * Web push for live-sharing boxes: docs/spec/notifications.md §4 (NT-23…NT-28)
 * and the wire protocol in §7b (NT-55, NT-56). `PushBrowser` and
 * `fakePushService` (helpers.ts) play the browser and the push service: every
 * push is decrypted with the receiving browser's keys.
 */

import { createExecutionContext, createScheduledController, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fromBase64Url, toBase64Url, toHex, utf8 } from "../src/bytes";
import { DAY_MS, PUSH_LIMITS, type Env } from "../src/env";
import worker, { handleRequest } from "../src/index";
import {
  DAILY_LIMIT,
  FLUSH_EVERY_MS,
  FRESH,
  PUSH_CRON,
  WINDOW_MS,
  flush,
  offer,
  utcDay,
  type Kind,
  type Send,
  type SubState,
} from "../src/push";
import {
  BoxDevice,
  PUSH_ENV,
  PushBrowser,
  VAPID,
  VAPID_SUBJECT,
  env,
  fakePushService,
  newId,
  record,
  shareLive,
  supporter,
  unsigned,
} from "./helpers";

afterEach(async () => {
  vi.restoreAllMocks();
  // Tests share the database: leave no subscription waiting for another test's cron.
  await env.DB.prepare("DELETE FROM push_subs").run();
});

// ---- The scheduling rules, on their own (push.ts) ------------------------------------

const MINUTE = 60_000;
const T0 = Date.UTC(2026, 10, 26, 9, 0, 0);

describe("NT-24: when a subscription is notified (push.ts)", () => {
  it("sends the first change at once, then holds changes for 15 minutes and coalesces them", () => {
    let step = offer(FRESH, "notes", T0);
    expect(step.send).toEqual({ kind: "notes", count: 1 });
    expect(step.next).toEqual({ lastSentAt: T0, pendingKind: null, pendingCount: 0, day: "2026-11-26", sentToday: 1 });

    step = offer(step.next, "notes", T0 + MINUTE);
    expect(step.send).toBeNull();
    expect(step.next).toMatchObject({ pendingKind: "notes", pendingCount: 1 });
    step = offer(step.next, "comment", T0 + 2 * MINUTE);
    expect(step.send).toBeNull();
    step = offer(step.next, "notes", T0 + 3 * MINUTE);
    expect(step.send).toBeNull();
    expect(step.next).toMatchObject({ pendingKind: "comment", pendingCount: 3 });

    // The cron, 5 and 10 minutes in: still inside the window.
    expect(flush(step.next, T0 + 5 * MINUTE).send).toBeNull();
    expect(flush(step.next, T0 + WINDOW_MS - 1).send).toBeNull();
    // 15 minutes after the last push: everything waiting goes out as one.
    const flushed = flush(step.next, T0 + WINDOW_MS);
    expect(flushed.send).toEqual({ kind: "comment", count: 3 });
    expect(flushed.next).toEqual({ lastSentAt: T0 + WINDOW_MS, pendingKind: null, pendingCount: 0, day: "2026-11-26", sentToday: 2 });
    // Nothing waiting: nothing to send.
    expect(flush(flushed.next, T0 + DAY_MS).send).toBeNull();
  });

  it("an offer after the window counts what waited plus itself", () => {
    const waiting: SubState = { lastSentAt: T0, pendingKind: "notes", pendingCount: 2, day: "2026-11-26", sentToday: 1 };
    expect(offer(waiting, "notes", T0 + WINDOW_MS).send).toEqual({ kind: "notes", count: 3 });
    expect(offer(waiting, "comment", T0 + WINDOW_MS).send).toEqual({ kind: "comment", count: 3 });
    expect(offer({ ...waiting, pendingKind: "comment" }, "notes", T0 + WINDOW_MS).send).toEqual({ kind: "comment", count: 3 });
  });

  it("sends at most 20 a UTC day; the next day starts again from 0", () => {
    const capped: SubState = { lastSentAt: T0, pendingKind: null, pendingCount: 0, day: "2026-11-26", sentToday: DAILY_LIMIT };
    const held = offer(capped, "comment", T0 + 2 * WINDOW_MS);
    expect(held.send).toBeNull();
    expect(flush(held.next, Date.UTC(2026, 10, 26, 23, 59, 59)).send).toBeNull();
    const nextDay = flush(held.next, Date.UTC(2026, 10, 27, 0, 0, 0));
    expect(nextDay.send).toEqual({ kind: "comment", count: 1 });
    expect(nextDay.next).toMatchObject({ day: "2026-11-27", sentToday: 1 });
    // 19 sent today: one more may go.
    expect(offer({ ...capped, sentToday: DAILY_LIMIT - 1 }, "notes", T0 + WINDOW_MS).send).toEqual({ kind: "notes", count: 1 });
  });

  it("the window spans midnight: a new day doesn't reset it", () => {
    const late: SubState = { lastSentAt: Date.UTC(2026, 10, 26, 23, 55), pendingKind: null, pendingCount: 0, day: "2026-11-26", sentToday: 3 };
    expect(offer(late, "notes", Date.UTC(2026, 10, 27, 0, 5)).send).toBeNull();
    expect(offer(late, "notes", Date.UTC(2026, 10, 27, 0, 10)).next).toMatchObject({ day: "2026-11-27", sentToday: 1 });
  });

  it("holds against a clock that goes backwards", () => {
    const sent = offer(FRESH, "notes", T0).next;
    expect(offer(sent, "notes", T0 - DAY_MS).send).toBeNull();
  });
});

/** mulberry32: a small seeded PRNG, so a failing run can be replayed by its seed. */
const prng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/**
 * One random history: writes at random gaps (mostly bursts a few minutes apart,
 * sometimes hours or days), with the cron every 5 minutes. Every send is checked
 * against an oracle that only looks at the sends so far: it must happen exactly
 * when the window and the day allow and something waits, with the right count
 * and kind.
 */
const simulate = (seed: number, writes: number) => {
  const random = prng(seed);
  let now = T0 + Math.floor(random() * DAY_MS);
  let state = FRESH;
  const sends: (Send & { at: number })[] = [];
  let held: Kind[] = [];
  let offered = 0;
  let nextCron = Math.ceil(now / FLUSH_EVERY_MS) * FLUSH_EVERY_MS;

  const perDay = new Map<string, number>();
  // The oracle: only the sends so far, never the state under test.
  const allowed = (at: number) => {
    const last = sends[sends.length - 1];
    return (last === undefined || at - last.at >= WINDOW_MS) && (perDay.get(utcDay(at)) ?? 0) < DAILY_LIMIT;
  };
  // Plain checks in this hot loop (expect() is slow), reported with the seed and time.
  const check = (ok: boolean, what: string, at: number) => {
    if (!ok) expect.fail(`seed ${seed}, ${new Date(at).toISOString()}: ${what}`);
  };
  const apply = (step: { send: Send | null; next: SubState }, at: number) => {
    check((step.send !== null) === (held.length > 0 && allowed(at)), step.send ? "sent when it may not" : "held when it may send", at);
    if (step.send) {
      check(step.send.count === held.length, `count ${step.send.count}, expected ${held.length}`, at);
      check(step.send.kind === (held.includes("comment") ? "comment" : "notes"), `kind ${step.send.kind}`, at);
      sends.push({ ...step.send, at });
      perDay.set(utcDay(at), (perDay.get(utcDay(at)) ?? 0) + 1);
      held = [];
    }
    state = step.next;
    check(state.pendingCount === held.length, "pending count", at);
  };
  const advanceTo = (time: number) => {
    for (; nextCron <= time; nextCron += FLUSH_EVERY_MS) apply(flush(state, nextCron), nextCron);
    now = time;
  };

  for (let i = 0; i < writes; i++) {
    const r = random();
    const gap =
      r < 0.7 ? random() * 10 * MINUTE : r < 0.9 ? random() * 60 * MINUTE : r < 0.98 ? random() * 12 * 60 * MINUTE : random() * 3 * DAY_MS;
    advanceTo(now + Math.floor(gap));
    const kind: Kind = random() < 0.3 ? "comment" : "notes";
    held.push(kind);
    offered++;
    apply(offer(state, kind, now), now);
  }
  // Once the writes stop, everything held back goes out within a day and a window.
  const lastWrite = now;
  advanceTo(now + DAY_MS + WINDOW_MS + FLUSH_EVERY_MS);
  return { sends, offered, held, state, lastWrite };
};

describe("NT-24 properties, over random histories", () => {
  it("never two pushes within 15 minutes, never more than 20 a UTC day, and no change is lost", () => {
    let cappedDays = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const { sends, offered, held, state, lastWrite } = simulate(seed, 300);
      for (let i = 1; i < sends.length; i++) expect(sends[i]!.at - sends[i - 1]!.at).toBeGreaterThanOrEqual(WINDOW_MS);
      const perDay = new Map<string, number>();
      for (const send of sends) perDay.set(utcDay(send.at), (perDay.get(utcDay(send.at)) ?? 0) + 1);
      for (const n of perDay.values()) expect(n).toBeLessThanOrEqual(DAILY_LIMIT);
      cappedDays += [...perDay.values()].filter((n) => n === DAILY_LIMIT).length;
      // Every offered change is in exactly one push: the counts add up, nothing still waits.
      expect(held).toEqual([]);
      expect(state.pendingCount).toBe(0);
      expect(sends.reduce((sum, s) => sum + s.count, 0)).toBe(offered);
      expect(sends[sends.length - 1]!.at).toBeLessThanOrEqual(lastWrite + DAY_MS + WINDOW_MS + FLUSH_EVERY_MS);
    }
    // The histories do reach the daily limit, so it's really exercised.
    expect(cappedDays).toBeGreaterThan(0);
  });

  it("counts add up at every moment: sent + waiting = offered", () => {
    for (let seed = 1000; seed < 1100; seed++) {
      const random = prng(seed);
      let state = FRESH;
      let now = T0;
      let sent = 0;
      for (let offered = 1; offered <= 200; offered++) {
        now += Math.floor(random() * 20 * MINUTE);
        let step = offer(state, random() < 0.5 ? "comment" : "notes", now);
        sent += step.send?.count ?? 0;
        if (random() < 0.3) {
          step = flush(step.next, now + Math.floor(random() * 20 * MINUTE));
          sent += step.send?.count ?? 0;
        }
        state = step.next;
        expect(sent + state.pendingCount).toBe(offered);
      }
    }
  });
});

// ---- The routes and the Worker ------------------------------------------------------

type Box = Awaited<ReturnType<typeof liveBox>>;

const liveBox = async (guests = 0) => {
  const account = await supporter();
  const box = await shareLive(account);
  expect(box.response.status).toBe(201);
  const members: BoxDevice[] = [];
  for (let i = 0; i < guests; i++) {
    const guest = await BoxDevice.create();
    expect((await guest.join(box.boxId, box.join)).status).toBe(201);
    members.push(guest);
  }
  return { account, ...box, members, versions: new Map<BoxDevice, number>() };
};

const subscribe = (device: BoxDevice, boxId: string, body: object | string, e: Env = PUSH_ENV) =>
  device.fetch("POST", `/v1/boxes/${boxId}/subscriptions`, { body, env: e });

/** Subscribes `browser` and returns its subId. */
const subscribed = async (device: BoxDevice, boxId: string, browser: PushBrowser) => {
  const response = await subscribe(device, boxId, browser.subscription);
  expect(response.status).toBe(201);
  return ((await response.json()) as { subId: string }).subId;
};

/** Writes `device`'s next copy with `Notify: <notify>`, and waits for the pushes it starts. */
const write = async (box: Box, device: BoxDevice, notify?: string, e: Env = PUSH_ENV) => {
  const version = box.versions.get(device);
  const ctx = createExecutionContext();
  const response = await device.putCopy(box.boxId, record(100), version === undefined ? {} : { version }, notify ? { notify } : {}, {
    env: e,
    ctx,
  });
  await waitOnExecutionContext(ctx);
  if (response.status === 200) box.versions.set(device, (version ?? 0) + 1);
  return response;
};

const runCron = async (cron: string, scheduledTime: number, e: Env = PUSH_ENV) => {
  const ctx = createExecutionContext();
  await worker.scheduled(createScheduledController({ cron, scheduledTime }), e, ctx);
  await waitOnExecutionContext(ctx);
};
const pushCron = (at: number, e: Env = PUSH_ENV) => runCron(PUSH_CRON, at, e);
const dailyCron = () => runCron("17 3 * * *", Date.now());

type SubRow = {
  sub_id: string;
  box_id: string;
  member_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  created_at: number;
  last_sent_at: number | null;
  pending_kind: string | null;
  pending_count: number;
  day: string | null;
  sent_today: number;
};

const subRow = (subId: string) => env.DB.prepare("SELECT * FROM push_subs WHERE sub_id = ?").bind(subId).first<SubRow>();
const subCount = async (where: string, ...values: unknown[]) =>
  (await env.DB.prepare(`SELECT COUNT(*) AS n FROM push_subs WHERE ${where}`).bind(...values).first<{ n: number }>())?.n ?? 0;

/** A subscription row written directly (for states the routes can't make). */
const insertSub = async (boxId: string, memberId: string, over: Partial<SubRow> = {}) => {
  const browser = await PushBrowser.create();
  const row: SubRow = {
    sub_id: newId(),
    box_id: boxId,
    member_id: memberId,
    ...browser.subscription,
    created_at: Date.now(),
    last_sent_at: null,
    pending_kind: null,
    pending_count: 0,
    day: null,
    sent_today: 0,
    ...over,
  };
  await env.DB.prepare(
    `INSERT INTO push_subs (sub_id, box_id, member_id, endpoint, p256dh, auth, created_at, last_sent_at, pending_kind,
       pending_count, day, sent_today) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(row.sub_id, row.box_id, row.member_id, row.endpoint, row.p256dh, row.auth, row.created_at, row.last_sent_at,
      row.pending_kind, row.pending_count, row.day, row.sent_today)
    .run();
  return { browser, subId: row.sub_id };
};

describe("GET /v1/push/key", () => {
  it("answers the VAPID public key, without auth", async () => {
    const response = await handleRequest(new Request("https://sync.test/v1/push/key"), PUSH_ENV);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { key: string };
    expect(body).toEqual({ key: VAPID.publicKey });
    const key = fromBase64Url(body.key)!;
    expect(key.length).toBe(65);
    expect(key[0]).toBe(0x04);
  });

  it("answers 503 push_unavailable when the Worker has no VAPID keys", async () => {
    const response = await unsigned("GET", "/v1/push/key");
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "push_unavailable" });
  });

  it("NT-50: has no other methods", async () => {
    const response = await unsigned("POST", "/v1/push/key");
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET");
  });
});

describe("POST /v1/boxes/:id/subscriptions", () => {
  it("stores the subscription for the calling member device and answers 201 {subId}", async () => {
    const box = await liveBox(1);
    const browser = await PushBrowser.create();
    const before = Date.now();
    const response = await subscribe(box.members[0]!, box.boxId, browser.subscription);
    expect(response.status).toBe(201);
    const { subId } = (await response.json()) as { subId: string };
    expect(subId).toMatch(/^[A-Za-z0-9_-]{22}$/);
    const row = await subRow(subId);
    expect(row).toMatchObject({
      box_id: box.boxId,
      member_id: box.members[0]!.memberId,
      ...browser.subscription,
      last_sent_at: null,
      pending_kind: null,
      pending_count: 0,
      day: null,
      sent_today: 0,
    });
    expect(row!.created_at).toBeGreaterThanOrEqual(before);
  });

  it("is idempotent per member device and endpoint: the same endpoint gets the same subId, with the newest keys", async () => {
    const box = await liveBox(1);
    const browser = await PushBrowser.create();
    const first = await subscribed(box.host, box.boxId, browser);
    expect(await subscribed(box.host, box.boxId, browser)).toBe(first);
    const newKeys = await PushBrowser.create();
    const again = await subscribe(box.host, box.boxId, { ...newKeys.subscription, endpoint: browser.endpoint });
    expect(again.status).toBe(201);
    expect(await again.json()).toEqual({ subId: first });
    expect(await subRow(first)).toMatchObject({ p256dh: newKeys.subscription.p256dh, auth: newKeys.subscription.auth });
    expect(await subCount("box_id = ?", box.boxId)).toBe(1);
    // Another member device with the same endpoint is another subscription.
    expect(await subscribed(box.members[0]!, box.boxId, browser)).not.toBe(first);
  });

  it("allows 5 per member device per box (409 too_many_subscriptions); an existing one still refreshes", async () => {
    const box = await liveBox(1);
    const browsers = await Promise.all(Array.from({ length: PUSH_LIMITS.subscriptions }, () => PushBrowser.create()));
    for (const browser of browsers) await subscribed(box.host, box.boxId, browser);
    const over = await subscribe(box.host, box.boxId, (await PushBrowser.create()).subscription);
    expect(over.status).toBe(409);
    expect(await over.json()).toEqual({ error: "too_many_subscriptions", limit: 5 });
    expect((await subscribe(box.host, box.boxId, browsers[0]!.subscription)).status).toBe(201);
    // Other member devices have their own 5.
    await subscribed(box.members[0]!, box.boxId, await PushBrowser.create());
    expect(await subCount("box_id = ? AND member_id = ?", box.boxId, box.host.memberId)).toBe(5);
  });

  it("NT-55: answers 400 bad_endpoint for anything but https on a known push service", async () => {
    const box = await liveBox();
    const { subscription } = await PushBrowser.create();
    for (const endpoint of [
      "http://fcm.googleapis.com/fcm/send/abc",
      "https://example.com/push",
      "https://fcm.googleapis.com.evil.test/fcm/send/abc",
      "https://evilfcm.googleapis.com/fcm/send/abc",
      "https://push.apple.com.evil.test/x",
      "https://fcm.googleapis.com:8443/fcm/send/abc",
      "https://169.254.169.254/latest",
      "https://localhost/push",
      "not a url",
    ]) {
      const response = await subscribe(box.host, box.boxId, { ...subscription, endpoint });
      expect(response.status, endpoint).toBe(400);
      expect(await response.json()).toEqual({ error: "bad_endpoint" });
    }
    for (const host of ["fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com", "wns2-par02p.notify.windows.com"]) {
      expect((await subscribe(box.host, box.boxId, (await PushBrowser.create(host)).subscription)).status, host).toBe(201);
    }
    expect(await subCount("box_id = ?", box.boxId)).toBe(4);
  });

  it("answers 400 bad_request for malformed bodies and keys", async () => {
    const box = await liveBox();
    const { subscription } = await PushBrowser.create();
    const p256dh = fromBase64Url(subscription.p256dh)!;
    for (const body of [
      "not json",
      [],
      {},
      { ...subscription, endpoint: 7 },
      { endpoint: subscription.endpoint, p256dh: subscription.p256dh },
      { ...subscription, p256dh: toBase64Url(p256dh.slice(1)) },
      { ...subscription, p256dh: toBase64Url(new Uint8Array([0x02, ...p256dh.slice(1)])) },
      { ...subscription, p256dh: "not base64url!" },
      { ...subscription, auth: toBase64Url(new Uint8Array(15)) },
      { ...subscription, auth: toBase64Url(new Uint8Array(17)) },
      { ...subscription, kind: "apns" },
      { ...subscription, kind: null },
    ]) {
      const response = await subscribe(box.host, box.boxId, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(await response.json()).toEqual({ error: "bad_request" });
    }
    expect((await subscribe(box.host, box.boxId, { kind: "webpush", ...subscription })).status).toBe(201);
  });

  it("answers 503 push_unavailable without VAPID keys, and stores nothing", async () => {
    const box = await liveBox();
    const response = await subscribe(box.host, box.boxId, (await PushBrowser.create()).subscription, env);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "push_unavailable" });
    expect(await subCount("box_id = ?", box.boxId)).toBe(0);
  });

  it("is for members: 401 unsigned, 403 not_member, 404 for an unknown box", async () => {
    const box = await liveBox();
    const { subscription } = await PushBrowser.create();
    const noAuth = await handleRequest(
      new Request(`https://sync.test/v1/boxes/${box.boxId}/subscriptions`, { method: "POST", body: JSON.stringify(subscription) }),
      PUSH_ENV
    );
    expect(noAuth.status).toBe(401);
    const stranger = await BoxDevice.create();
    const notMember = await subscribe(stranger, box.boxId, subscription);
    expect(notMember.status).toBe(403);
    expect(await notMember.json()).toEqual({ error: "not_member" });
    expect((await subscribe(stranger, newId(), subscription)).status).toBe(404);
    expect(await subCount("box_id = ?", box.boxId)).toBe(0);
  });
});

describe("DELETE /v1/boxes/:id/subscriptions/:subId (NT-28)", () => {
  it("deletes the caller's own subscription (204), then answers 404", async () => {
    const box = await liveBox();
    const subId = await subscribed(box.host, box.boxId, await PushBrowser.create());
    const path = `/v1/boxes/${box.boxId}/subscriptions/${subId}`;
    expect((await box.host.fetch("DELETE", path, { env: PUSH_ENV })).status).toBe(204);
    expect(await subRow(subId)).toBeNull();
    const again = await box.host.fetch("DELETE", path, { env: PUSH_ENV });
    expect(again.status).toBe(404);
    expect(await again.json()).toEqual({ error: "not_found" });
  });

  it("can't delete another member's subscription (404), nor one in another box", async () => {
    const box = await liveBox(1);
    const other = await liveBox();
    const subId = await subscribed(box.host, box.boxId, await PushBrowser.create());
    expect((await box.members[0]!.fetch("DELETE", `/v1/boxes/${box.boxId}/subscriptions/${subId}`)).status).toBe(404);
    expect((await other.host.fetch("DELETE", `/v1/boxes/${other.boxId}/subscriptions/${subId}`)).status).toBe(404);
    expect(await subRow(subId)).not.toBeNull();
  });

  it("works without VAPID keys (turning off always works), and needs a well-formed id", async () => {
    const box = await liveBox();
    const subId = await subscribed(box.host, box.boxId, await PushBrowser.create());
    expect((await box.host.fetch("DELETE", `/v1/boxes/${box.boxId}/subscriptions/nope`)).status).toBe(400);
    expect((await box.host.fetch("DELETE", `/v1/boxes/${box.boxId}/subscriptions/${subId}`, { env })).status).toBe(204);
  });

  it("NT-50: subscriptions have no other methods", async () => {
    const box = await liveBox();
    const list = await box.host.fetch("GET", `/v1/boxes/${box.boxId}/subscriptions`);
    expect(list.status).toBe(405);
    expect(list.headers.get("allow")).toBe("POST");
    const one = await box.host.fetch("GET", `/v1/boxes/${box.boxId}/subscriptions/${newId()}`);
    expect(one.status).toBe(405);
    expect(one.headers.get("allow")).toBe("DELETE");
  });
});

describe("NT-23, NT-25: a write tells every other member device", () => {
  it("pushes {box, kind, count} to every subscription of the other members, never the writer's", async () => {
    const box = await liveBox(2);
    const [ana, ben] = box.members as [BoxDevice, BoxDevice];
    const anaPhone = await PushBrowser.create();
    const anaLaptop = await PushBrowser.create("updates.push.services.mozilla.com");
    const benPhone = await PushBrowser.create("web.push.apple.com");
    const hostPhone = await PushBrowser.create();
    await subscribed(ana, box.boxId, anaPhone);
    await subscribed(ana, box.boxId, anaLaptop);
    await subscribed(ben, box.boxId, benPhone);
    await subscribed(box.host, box.boxId, hostPhone);
    const service = fakePushService([anaPhone, anaLaptop, benPhone, hostPhone]);

    const before = Date.now();
    expect((await write(box, box.host, "comment")).status).toBe(200);

    expect(service.delivered).toHaveLength(3);
    for (const browser of [anaPhone, anaLaptop, benPhone]) {
      const [push] = service.delivered.filter((d) => d.browser === browser);
      // Exactly these three fields, in this order: no names, no text, no other ids.
      expect(push!.plaintext).toBe(`{"box":"${box.boxId}","kind":"comment","count":1}`);
      expect(push!.headers.get("ttl")).toBe("86400");
      expect(push!.headers.get("urgency")).toBe("normal");
      expect(push!.headers.get("topic")).toBe(box.boxId);
      expect(push!.headers.get("content-encoding")).toBe("aes128gcm");
      expect(push!.headers.get("content-type")).toBe("application/octet-stream");

      const match = push!.headers.get("authorization")!.match(/^vapid t=([^.]+)\.([^.]+)\.([^.,]+), k=(.+)$/);
      expect(match).not.toBeNull();
      const [, header, claims, signature, k] = match!;
      expect(k).toBe(VAPID.publicKey);
      const valid = await crypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        VAPID.verifyKey,
        fromBase64Url(signature!)!,
        utf8(`${header}.${claims}`)
      );
      expect(valid).toBe(true);
      const decoded = JSON.parse(new TextDecoder().decode(fromBase64Url(claims!)!)) as { aud: string; exp: number; sub: string };
      expect(decoded.aud).toBe(new URL(browser.endpoint).origin);
      expect(decoded.sub).toBe(VAPID_SUBJECT);
      expect(decoded.exp).toBeGreaterThan(before / 1000);
      expect(decoded.exp).toBeLessThanOrEqual(Date.now() / 1000 + 24 * 3600);
    }
    expect(service.to(hostPhone)).toEqual([]);

    // Later, Ben writes notes: the host and Ana are told, Ben isn't.
    await env.DB.prepare("UPDATE push_subs SET last_sent_at = ? WHERE box_id = ?").bind(Date.now() - WINDOW_MS, box.boxId).run();
    expect((await write(box, ben, "notes")).status).toBe(200);
    expect(service.to(hostPhone)).toEqual([{ box: box.boxId, kind: "notes", count: 1 }]);
    expect(service.to(anaPhone)).toEqual([
      { box: box.boxId, kind: "comment", count: 1 },
      { box: box.boxId, kind: "notes", count: 1 },
    ]);
    expect(service.to(benPhone)).toHaveLength(1);
    expect(await subCount("box_id = ? AND member_id = ? AND pending_count > 0", box.boxId, ben.memberId)).toBe(0);
  });

  it("sends nothing for Notify: none, no Notify header, or an unknown value", async () => {
    const box = await liveBox(1);
    const browser = await PushBrowser.create();
    const subId = await subscribed(box.members[0]!, box.boxId, browser);
    const service = fakePushService([browser]);
    for (const notify of ["none", undefined, "everything", ""]) expect((await write(box, box.host, notify)).status).toBe(200);
    expect(service.spy).not.toHaveBeenCalled();
    expect(await subRow(subId)).toMatchObject({ pending_count: 0, last_sent_at: null });
    // The header's case doesn't matter.
    await write(box, box.host, " Comment ");
    expect(service.to(browser)).toEqual([{ box: box.boxId, kind: "comment", count: 1 }]);
  });

  it("sends nothing for a refused write (412), or a read-only box's (402)", async () => {
    const box = await liveBox(1);
    const browser = await PushBrowser.create();
    await subscribed(box.members[0]!, box.boxId, browser);
    const service = fakePushService([browser]);
    await write(box, box.host, "none");
    box.versions.set(box.host, 7);
    expect((await write(box, box.host, "comment")).status).toBe(412);
    box.versions.set(box.host, 1);
    await env.DB.prepare("UPDATE accounts SET status = 'lapsed', lapsed_at = ? WHERE account_id = ?").bind(Date.now(), box.account.accountId).run();
    expect((await write(box, box.host, "comment")).status).toBe(402);
    expect(service.spy).not.toHaveBeenCalled();
    expect(await subCount("box_id = ? AND pending_count > 0", box.boxId)).toBe(0);
  });

  it("answers the write without waiting for the push service", async () => {
    const box = await liveBox(1);
    const browser = await PushBrowser.create();
    await subscribed(box.members[0]!, box.boxId, browser);
    let open: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (open = resolve));
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      await gate;
      return new Response(null, { status: 201 });
    });
    const ctx = createExecutionContext();
    const response = await box.host.putCopy(box.boxId, record(100), {}, { notify: "comment" }, { env: PUSH_ENV, ctx });
    expect(response.status).toBe(200);
    let settled = false;
    const background = waitOnExecutionContext(ctx).then(() => (settled = true));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(settled).toBe(false);
    open();
    await background;
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the Worker has no VAPID keys", async () => {
    const box = await liveBox(1);
    const { subId, browser } = await insertSub(box.boxId, box.members[0]!.memberId);
    const service = fakePushService([browser]);
    expect((await write(box, box.host, "comment", env)).status).toBe(200);
    await pushCron(Date.now() + DAY_MS, env);
    expect(service.spy).not.toHaveBeenCalled();
    expect(await subRow(subId)).toMatchObject({ pending_count: 0, last_sent_at: null });
  });
});

describe("NT-24: at most one push per device every 15 minutes, 20 a day (D1 and the 5-minute cron)", () => {
  it("holds changes inside the window and the cron sends them as one, comment beating notes", async () => {
    const box = await liveBox(1);
    const browser = await PushBrowser.create();
    const subId = await subscribed(box.members[0]!, box.boxId, browser);
    const service = fakePushService([browser]);

    await write(box, box.host, "notes");
    expect(service.to(browser)).toEqual([{ box: box.boxId, kind: "notes", count: 1 }]);
    const sentAt = (await subRow(subId))!.last_sent_at!;
    expect(await subRow(subId)).toMatchObject({ pending_count: 0, pending_kind: null, day: utcDay(sentAt), sent_today: 1 });

    await write(box, box.host, "notes");
    expect(await subRow(subId)).toMatchObject({ pending_count: 1, pending_kind: "notes" });
    await write(box, box.host, "comment");
    await write(box, box.host, "notes");
    expect(await subRow(subId)).toMatchObject({ pending_count: 3, pending_kind: "comment", last_sent_at: sentAt });
    expect(service.delivered).toHaveLength(1);

    await pushCron(sentAt + 5 * MINUTE);
    await pushCron(sentAt + WINDOW_MS - 1);
    expect(service.delivered).toHaveLength(1);

    await pushCron(sentAt + WINDOW_MS);
    expect(service.to(browser)).toEqual([
      { box: box.boxId, kind: "notes", count: 1 },
      { box: box.boxId, kind: "comment", count: 3 },
    ]);
    const after = (await subRow(subId))!;
    expect(after).toMatchObject({ pending_count: 0, pending_kind: null, last_sent_at: sentAt + WINDOW_MS });
    expect(after.sent_today).toBe(utcDay(sentAt + WINDOW_MS) === utcDay(sentAt) ? 2 : 1);
    // Nothing waits now: the next cron sends nothing.
    await pushCron(sentAt + 2 * WINDOW_MS);
    expect(service.delivered).toHaveLength(2);
  });

  it("after 20 pushes in a UTC day, changes wait for the next day", async () => {
    const box = await liveBox(1);
    const browser = await PushBrowser.create();
    const subId = await subscribed(box.members[0]!, box.boxId, browser);
    const service = fakePushService([browser]);
    const today = utcDay(Date.now());
    await env.DB.prepare("UPDATE push_subs SET last_sent_at = ?, day = ?, sent_today = ? WHERE sub_id = ?")
      .bind(Date.now() - 2 * WINDOW_MS, today, DAILY_LIMIT, subId)
      .run();

    await write(box, box.host, "comment");
    await write(box, box.host, "notes");
    expect(service.delivered).toHaveLength(0);
    expect(await subRow(subId)).toMatchObject({ pending_count: 2, pending_kind: "comment", sent_today: DAILY_LIMIT });
    await pushCron(Date.now());
    expect(service.delivered).toHaveLength(0);

    const tomorrow = Date.parse(`${today}T00:00:00Z`) + DAY_MS + MINUTE;
    await pushCron(tomorrow);
    expect(service.to(browser)).toEqual([{ box: box.boxId, kind: "comment", count: 2 }]);
    expect(await subRow(subId)).toMatchObject({ pending_count: 0, day: utcDay(tomorrow), sent_today: 1, last_sent_at: tomorrow });
  });

  it("the cron sends to every waiting subscription that's due, across boxes, and skips the rest", async () => {
    const boxes = [await liveBox(1), await liveBox(1)];
    const now = Date.now();
    const due = await insertSub(boxes[0]!.boxId, boxes[0]!.members[0]!.memberId, { pending_count: 2, pending_kind: "notes", last_sent_at: now - WINDOW_MS });
    const never = await insertSub(boxes[1]!.boxId, boxes[1]!.members[0]!.memberId, { pending_count: 1, pending_kind: "comment" });
    const early = await insertSub(boxes[1]!.boxId, boxes[1]!.host.memberId, { pending_count: 4, pending_kind: "notes", last_sent_at: now - WINDOW_MS + MINUTE });
    const idle = await insertSub(boxes[0]!.boxId, boxes[0]!.host.memberId, { last_sent_at: now - DAY_MS });
    const service = fakePushService([due.browser, never.browser, early.browser, idle.browser]);
    await pushCron(now);
    expect(service.to(due.browser)).toEqual([{ box: boxes[0]!.boxId, kind: "notes", count: 2 }]);
    expect(service.to(never.browser)).toEqual([{ box: boxes[1]!.boxId, kind: "comment", count: 1 }]);
    expect(service.to(early.browser)).toEqual([]);
    expect(service.to(idle.browser)).toEqual([]);
    expect(await subRow(early.subId)).toMatchObject({ pending_count: 4 });
  });

  it("a concurrent second write never sends twice in one window", async () => {
    const box = await liveBox(2);
    const browser = await PushBrowser.create();
    await subscribed(box.members[0]!, box.boxId, browser);
    const service = fakePushService([browser]);
    const ctx = createExecutionContext();
    await Promise.all([
      box.host.putCopy(box.boxId, record(100), {}, { notify: "notes" }, { env: PUSH_ENV, ctx }),
      box.members[1]!.putCopy(box.boxId, record(100), {}, { notify: "comment" }, { env: PUSH_ENV, ctx }),
    ]);
    await waitOnExecutionContext(ctx);
    const sent = service.to(browser) as { count: number }[];
    expect(sent).toHaveLength(1);
    const row = (await env.DB.prepare("SELECT pending_count FROM push_subs WHERE box_id = ?").bind(box.boxId).first<{ pending_count: number }>())!;
    // Both changes are accounted for: one sent (possibly with the other), the rest waiting.
    expect(sent[0]!.count + row.pending_count).toBe(2);
  });
});

describe("NT-28: what the push service answers", () => {
  it.each([404, 410])("%i: the subscription is deleted at once", async (status) => {
    const box = await liveBox(1);
    const gone = await PushBrowser.create();
    const fine = await PushBrowser.create();
    const goneId = await subscribed(box.members[0]!, box.boxId, gone);
    const fineId = await subscribed(box.members[0]!, box.boxId, fine);
    const service = fakePushService([gone, fine]);
    service.answer(gone, status);
    await write(box, box.host, "comment");
    expect(await subRow(goneId)).toBeNull();
    expect(await subRow(fineId)).toMatchObject({ pending_count: 0, sent_today: 1 });
    expect(service.to(fine)).toHaveLength(1);
  });

  it.each([429, 500, 503, "network"] as const)("%s: the change waits, and the 5-minute cron sends it", async (answer) => {
    const box = await liveBox(1);
    const browser = await PushBrowser.create();
    const subId = await subscribed(box.members[0]!, box.boxId, browser);
    const service = fakePushService([browser]);
    service.answer(browser, answer);
    await write(box, box.host, "comment");
    // The failed attempt doesn't count: no window, no day count.
    expect(await subRow(subId)).toMatchObject({ pending_count: 1, pending_kind: "comment", last_sent_at: null, day: null, sent_today: 0 });

    await write(box, box.host, "notes");
    expect(await subRow(subId)).toMatchObject({ pending_count: 2, pending_kind: "comment", last_sent_at: null });
    // Still failing at the next cron: it keeps waiting.
    await pushCron(Date.now() + FLUSH_EVERY_MS);
    expect(await subRow(subId)).toMatchObject({ pending_count: 2, last_sent_at: null });

    service.answer(browser, 201);
    const at = Date.now() + 2 * FLUSH_EVERY_MS;
    await pushCron(at);
    expect(service.delivered.filter((d) => d.status === 201).map((d) => JSON.parse(d.plaintext) as unknown)).toEqual([
      { box: box.boxId, kind: "comment", count: 2 },
    ]);
    expect(await subRow(subId)).toMatchObject({ pending_count: 0, pending_kind: null, last_sent_at: at, sent_today: 1 });
  });

  it("a failed attempt after earlier pushes restores the window and day count as they were", async () => {
    const box = await liveBox(1);
    const browser = await PushBrowser.create();
    const subId = await subscribed(box.members[0]!, box.boxId, browser);
    const service = fakePushService([browser]);
    const earlier = Date.now() - WINDOW_MS - MINUTE;
    const today = utcDay(Date.now());
    await env.DB.prepare("UPDATE push_subs SET last_sent_at = ?, day = ?, sent_today = 3 WHERE sub_id = ?").bind(earlier, today, subId).run();
    service.answer(browser, 502);
    await write(box, box.host, "notes");
    expect(await subRow(subId)).toMatchObject({ pending_count: 1, last_sent_at: earlier, day: today, sent_today: 3 });
  });

  it("another error (e.g. 400, 403): logged and dropped, the subscription stays", async () => {
    const box = await liveBox(1);
    const browser = await PushBrowser.create();
    const subId = await subscribed(box.members[0]!, box.boxId, browser);
    const service = fakePushService([browser]);
    service.answer(browser, 403);
    await write(box, box.host, "comment");
    expect(await subRow(subId)).toMatchObject({ pending_count: 0, sent_today: 1 });
    expect(service.delivered).toHaveLength(1);
  });
});

describe("NT-56: subscriptions go with their member device and box", () => {
  it("leaving deletes the leaving device's subscriptions, and only those", async () => {
    const box = await liveBox(2);
    const [ana, ben] = box.members as [BoxDevice, BoxDevice];
    await subscribed(ana, box.boxId, await PushBrowser.create());
    await subscribed(ana, box.boxId, await PushBrowser.create());
    await subscribed(ben, box.boxId, await PushBrowser.create());
    const hostSub = await subscribed(box.host, box.boxId, await PushBrowser.create());
    expect((await ana.fetch("DELETE", `/v1/boxes/${box.boxId}/members/me`)).status).toBe(204);
    expect(await subCount("box_id = ? AND member_id = ?", box.boxId, ana.memberId)).toBe(0);
    expect(await subCount("box_id = ?", box.boxId)).toBe(2);
    expect(await subRow(hostSub)).not.toBeNull();
  });

  it("Stop sharing deletes every subscription in the box, and no other box's", async () => {
    const box = await liveBox(1);
    const other = await liveBox(1);
    await subscribed(box.host, box.boxId, await PushBrowser.create());
    await subscribed(box.members[0]!, box.boxId, await PushBrowser.create());
    const kept = await subscribed(other.members[0]!, other.boxId, await PushBrowser.create());
    expect((await box.host.fetch("DELETE", `/v1/boxes/${box.boxId}`)).status).toBe(204);
    expect(await subCount("box_id = ?", box.boxId)).toBe(0);
    expect(await subRow(kept)).not.toBeNull();
  });

  it("deleting the host's account deletes the subscriptions of its boxes", async () => {
    const box = await liveBox(1);
    const second = await shareLive(box.account);
    const other = await liveBox(1);
    await subscribed(box.members[0]!, box.boxId, await PushBrowser.create());
    await subscribed(second.host, second.boxId, await PushBrowser.create());
    const kept = await subscribed(other.members[0]!, other.boxId, await PushBrowser.create());
    expect((await box.account.fetch("DELETE", "/v1/account")).status).toBe(204);
    expect(await subCount("box_id IN (?, ?)", box.boxId, second.boxId)).toBe(0);
    expect(await subRow(kept)).not.toBeNull();
  });

  it("the daily cron deletes subscriptions whose box or member device is gone", async () => {
    const box = await liveBox(1);
    const kept = await subscribed(box.members[0]!, box.boxId, await PushBrowser.create());
    const noBox = await insertSub(newId(), newId());
    const noMember = await insertSub(box.boxId, newId());
    await dailyCron();
    expect(await subRow(noBox.subId)).toBeNull();
    expect(await subRow(noMember.subId)).toBeNull();
    expect(await subRow(kept)).not.toBeNull();
  });

  it("NT-53: the daily cron deletes subscriptions with changes undelivered for 60 days, and clears old day counters", async () => {
    const box = await liveBox(1);
    const memberId = box.members[0]!.memberId;
    const now = Date.now();
    const stuck = await insertSub(box.boxId, memberId, { pending_count: 3, pending_kind: "notes", last_sent_at: now - 61 * DAY_MS });
    const stuckNever = await insertSub(box.boxId, memberId, { pending_count: 1, pending_kind: "notes", created_at: now - 61 * DAY_MS });
    const recent = await insertSub(box.boxId, memberId, { pending_count: 3, pending_kind: "notes", last_sent_at: now - 59 * DAY_MS });
    const quiet = await insertSub(box.boxId, memberId, { last_sent_at: now - 90 * DAY_MS, day: "2026-01-01", sent_today: 5 });
    const today = await insertSub(box.boxId, box.host.memberId, { last_sent_at: now, day: utcDay(now), sent_today: 2 });
    await dailyCron();
    expect(await subRow(stuck.subId)).toBeNull();
    expect(await subRow(stuckNever.subId)).toBeNull();
    expect(await subRow(recent.subId)).not.toBeNull();
    expect(await subRow(quiet.subId)).toMatchObject({ day: null, sent_today: 0 });
    expect(await subRow(today.subId)).toMatchObject({ day: utcDay(now), sent_today: 2 });
  });

  it("each cron does only its own job", async () => {
    const box = await liveBox(1);
    const waiting = await insertSub(box.boxId, box.members[0]!.memberId, { pending_count: 1, pending_kind: "notes" });
    const orphan = await insertSub(newId(), newId());
    const service = fakePushService([waiting.browser, orphan.browser]);
    await dailyCron();
    expect(service.spy).not.toHaveBeenCalled();
    expect(await subRow(orphan.subId)).toBeNull();
    const orphan2 = await insertSub(newId(), newId());
    await pushCron(Date.now());
    expect(service.to(waiting.browser)).toHaveLength(1);
    expect(await subRow(orphan2.subId)).not.toBeNull();
  });
});

describe("NT-51 / SY-44: nothing about a push reaches the logs but route, status and code", () => {
  it("logs no endpoints, keys, ids or payloads, through subscribing, pushing, failures and the crons", async () => {
    const MARKER = "ZqxSecretPushEndpoint";
    const lines: string[] = [];
    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        lines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
      });
    }
    const box = await liveBox(2);
    const [ana, ben] = box.members as [BoxDevice, BoxDevice];
    const gone = await PushBrowser.create();
    const failing = await PushBrowser.create();
    const unreachable = await PushBrowser.create();
    const rejected = await PushBrowser.create();
    const subIds = [
      await subscribed(ana, box.boxId, gone),
      await subscribed(ana, box.boxId, failing),
      await subscribed(ben, box.boxId, unreachable),
      await subscribed(ben, box.boxId, rejected),
    ];
    const service = fakePushService([gone, failing, unreachable, rejected]);
    service.answer(gone, 410);
    service.answer(failing, 503);
    service.answer(unreachable, "network");
    service.answer(rejected, 400);
    await subscribe(ana, box.boxId, { ...gone.subscription, endpoint: `https://${MARKER}.evil.test/push` });
    await subscribe(ana, box.boxId, { ...gone.subscription, endpoint: `https://fcm.googleapis.com/${MARKER}` }, env);
    await write(box, box.host, "comment");
    await pushCron(Date.now() + FLUSH_EVERY_MS);
    await ben.fetch("DELETE", `/v1/boxes/${box.boxId}/subscriptions/${subIds[3]}`, { env: PUSH_ENV });
    await ben.fetch("DELETE", `/v1/boxes/${box.boxId}/subscriptions/${newId()}`, { env: PUSH_ENV });
    await dailyCron();

    const everything = lines.join("\n");
    expect(everything).toContain("push_gone");
    expect(everything).toContain("push_retry");
    expect(everything).toContain("push_unreachable");
    expect(everything).toContain("push_failed");
    const secrets = [
      MARKER,
      box.boxId,
      box.host.memberId,
      ana.memberId,
      ben.memberId,
      VAPID.privateKey,
      VAPID.publicKey,
      "vapid t=",
      `"box":`,
      ...subIds,
      ...[gone, failing, unreachable, rejected].flatMap((b) => [
        b.endpoint,
        new URL(b.endpoint).pathname,
        b.subscription.p256dh,
        b.subscription.auth,
        toHex(b.authSecret),
      ]),
    ];
    for (const secret of secrets) expect(everything).not.toContain(secret);
    for (const line of lines) {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      expect(Object.keys(parsed)).toEqual(expect.arrayContaining(["route", "status", "code"]));
      expect(String(parsed.route)).not.toMatch(/[A-Za-z0-9_-]{22}/);
    }
  });
});
