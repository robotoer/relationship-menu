/**
 * Store-app push through Firebase Cloud Messaging HTTP v1:
 * docs/spec/notifications.md §6 (NT-40…NT-42) and the wire protocol in §7c.
 * `makeServiceAccount` makes a Google service account with a fresh RSA key, and
 * `fakeGoogle` (helpers.ts) plays Google: its token endpoint checks every
 * signed assertion, and its messages:send records each message.
 */

import { createExecutionContext, createScheduledController, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fromBase64Url, utf8 } from "../src/bytes";
import { DAY_MS, PUSH_LIMITS, type Env } from "../src/env";
import {
  ASSERTION_LIFETIME_SECONDS,
  FCM_SCOPE,
  FCM_TOKEN_URL,
  TOKEN_REFRESH_EARLY_MS,
  fcmAccessToken,
  fcmAccount,
  fcmAssertion,
  fcmBody,
  fcmMessage,
  fcmSendUrl,
  parseServiceAccount,
  resetFcmCache,
  sendFcm,
  type FcmAccount,
} from "../src/fcm";
import worker, { handleRequest } from "../src/index";
import { FLUSH_EVERY_MS, PUSH_CRON, WINDOW_MS } from "../src/push";
import type { FetchLike } from "../src/webpush";
import {
  BoxDevice,
  PUSH_ENV,
  PushBrowser,
  env,
  fakeGoogle,
  fakePushService,
  fcmEnv,
  fcmErrorBody,
  fcmToken,
  makeServiceAccount,
  newId,
  record,
  serviceAccount,
  shareLive,
  supporter,
  type TestServiceAccount,
} from "./helpers";

const SA = await serviceAccount();
const FCM_ENV = await fcmEnv(SA);
/** FCM on, web push off. */
const FCM_ONLY: Env = { ...env, FCM_SERVICE_ACCOUNT: SA.json };

beforeEach(() => resetFcmCache());
afterEach(async () => {
  vi.restoreAllMocks();
  await env.DB.prepare("DELETE FROM push_subs").run();
});

const MINUTE = 60_000;
const T0 = Date.UTC(2026, 10, 26, 9, 0, 0);

const account = async (sa: TestServiceAccount = SA): Promise<FcmAccount> => (await fcmAccount({ ...env, FCM_SERVICE_ACCOUNT: sa.json }))!;

const decodePart = (part: string) => JSON.parse(new TextDecoder().decode(fromBase64Url(part)!)) as Record<string, unknown>;

// ---- The service account --------------------------------------------------------------

describe("NT-40: the service account (FCM_SERVICE_ACCOUNT)", () => {
  it("reads project_id, client_email and the PKCS#8 private key of a Google JSON key", async () => {
    const parsed = parseServiceAccount(SA.json)!;
    expect(parsed.projectId).toBe(SA.projectId);
    expect(parsed.clientEmail).toBe(SA.clientEmail);
    expect(parsed.privateKeyPkcs8[0]).toBe(0x30);
    const loaded = await account();
    expect(loaded).toMatchObject({ projectId: SA.projectId, clientEmail: SA.clientEmail, token: null });
    expect(loaded.key.extractable).toBe(false);
    // Imported once per isolate and secret.
    expect(await account()).toBe(loaded);
  });

  it("is off (null) when missing or malformed, so FCM answers 503 and nothing is sent", async () => {
    const base = JSON.parse(SA.json) as Record<string, unknown>;
    const variant = (over: Record<string, unknown>) => JSON.stringify({ ...base, ...over });
    const der = parseServiceAccount(SA.json)!.privateKeyPkcs8;
    const garbled = new Uint8Array(der);
    garbled.fill(0x41, 20, 200);
    const pemOf = (bytes: Uint8Array) =>
      `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...bytes))}\n-----END PRIVATE KEY-----\n`;
    for (const secret of [
      undefined,
      "",
      "not json",
      "[]",
      "null",
      variant({ type: "authorized_user" }),
      variant({ project_id: undefined }),
      variant({ project_id: "Wants-Test" }),
      variant({ project_id: "wants-test/../../x" }),
      variant({ project_id: "wants-test?x=1" }),
      variant({ project_id: "short" }),
      variant({ project_id: "wants-test-" }),
      variant({ project_id: 12345678 }),
      variant({ client_email: undefined }),
      variant({ client_email: "not an email" }),
      variant({ private_key: undefined }),
      variant({ private_key: "MIIEvQIBADANBg" }),
      variant({ private_key: SA.privateKeyPem.replace("PRIVATE KEY", "RSA PRIVATE KEY") }),
      variant({ private_key: SA.privateKeyPem.replace(/[A-Za-z0-9+/]{64}/, "!".repeat(64)) }),
      variant({ private_key: pemOf(garbled) }),
    ]) {
      expect(await fcmAccount({ ...env, FCM_SERVICE_ACCOUNT: secret }), String(secret).slice(0, 80)).toBeNull();
    }
  });
});

// ---- OAuth -------------------------------------------------------------------------------

describe("NT-40: the OAuth token (RS256 JWT bearer grant)", () => {
  it("signs an RS256 JWT: iss = client_email, the FCM scope, aud = the token endpoint, valid 1 hour", async () => {
    const jwt = await fcmAssertion(await account(), T0);
    const [header, claims, signature] = jwt.split(".") as [string, string, string];
    expect(decodePart(header)).toEqual({ alg: "RS256", typ: "JWT" });
    expect(decodePart(claims)).toEqual({
      iss: SA.clientEmail,
      scope: FCM_SCOPE,
      aud: FCM_TOKEN_URL,
      iat: T0 / 1000,
      exp: T0 / 1000 + ASSERTION_LIFETIME_SECONDS,
    });
    expect(ASSERTION_LIFETIME_SECONDS).toBeLessThanOrEqual(3600);
    expect(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", SA.verifyKey, fromBase64Url(signature)!, utf8(`${header}.${claims}`))).toBe(true);
    // Another key's signature doesn't verify.
    const other = await makeServiceAccount();
    expect(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", other.verifyKey, fromBase64Url(signature)!, utf8(`${header}.${claims}`))).toBe(false);
  });

  it("exchanges it at the token endpoint, and Google accepts it", async () => {
    const google = fakeGoogle(SA);
    const result = await fcmAccessToken(await account(), { fetch: google.fetch, nowMs: T0 });
    expect(result).toEqual({ ok: true, token: [...google.issued][0] });
    expect(google.assertions).toHaveLength(1);
    expect(google.assertions[0]!.claims).toMatchObject({ iat: T0 / 1000, exp: T0 / 1000 + 3600 });
  });

  it("caches the access token until a minute before it expires, then gets a new one", async () => {
    const google = fakeGoogle(SA);
    const loaded = await account();
    const tokenAt = async (nowMs: number) => {
      const result = await fcmAccessToken(loaded, { fetch: google.fetch, nowMs });
      expect(result.ok).toBe(true);
      return (result as { token: string }).token;
    };
    const first = await tokenAt(T0);
    for (let i = 1; i <= 50; i++) expect(await tokenAt(T0 + i * MINUTE - 1)).toBe(first);
    expect(await tokenAt(T0 + 3600_000 - TOKEN_REFRESH_EARLY_MS - 1)).toBe(first);
    expect(google.assertions).toHaveLength(1);
    const second = await tokenAt(T0 + 3600_000 - TOKEN_REFRESH_EARLY_MS);
    expect(second).not.toBe(first);
    expect(google.assertions).toHaveLength(2);
    expect(google.assertions[1]!.claims.iat).toBe((T0 + 3600_000 - TOKEN_REFRESH_EARLY_MS) / 1000);
    // A clock that went backwards doesn't trust a token from "the future".
    await tokenAt(T0);
    expect(google.assertions).toHaveLength(3);
  });

  it("uses a short-lived token only once, and a new secret gets a new account and token", async () => {
    const google = fakeGoogle(SA);
    google.state.expiresIn = 30;
    const loaded = await account();
    await fcmAccessToken(loaded, { fetch: google.fetch, nowMs: T0 });
    await fcmAccessToken(loaded, { fetch: google.fetch, nowMs: T0 + 1 });
    expect(google.assertions).toHaveLength(2);
    const other = await makeServiceAccount("wants-other-9z8y7");
    expect((await account(other)).clientEmail).toBe(other.clientEmail);
    expect(await account(other)).not.toBe(loaded);
  });

  it.each([
    [500, { result: "retry", status: 500, code: "push_retry" }],
    [503, { result: "retry", status: 503, code: "push_retry" }],
    [429, { result: "retry", status: 429, code: "push_retry" }],
    [400, { result: "auth", status: 400, code: "push_auth" }],
    [401, { result: "auth", status: 401, code: "push_auth" }],
    ["network", { result: "retry", status: 0, code: "push_unreachable" }],
    [{ status: 200, body: { token_type: "Bearer" } }, { result: "auth", status: 200, code: "push_auth" }],
    [{ status: 200, body: { access_token: "has space", expires_in: 3600 } }, { result: "auth", status: 200, code: "push_auth" }],
    [{ status: 200, body: { access_token: "ya29.ok", expires_in: "3600" } }, { result: "auth", status: 200, code: "push_auth" }],
    [{ status: 302, body: {} }, { result: "auth", status: 302, code: "push_auth" }],
  ] as const)("the token endpoint answering %j: %j, and nothing is cached", async (answer, outcome) => {
    const google = fakeGoogle(SA);
    google.state.tokenAnswer = answer;
    const loaded = await account();
    expect(await fcmAccessToken(loaded, { fetch: google.fetch, nowMs: T0 })).toEqual({ ok: false, outcome });
    expect(loaded.token).toBeNull();
  });

  it("a rejected assertion (another key) is an auth failure", async () => {
    const google = fakeGoogle(await makeServiceAccount(SA.projectId));
    const result = await fcmAccessToken(await account(), { fetch: google.fetch, nowMs: T0 });
    expect(result).toEqual({ ok: false, outcome: { result: "auth", status: 400, code: "push_auth" } });
  });
});

// ---- The message -------------------------------------------------------------------------

describe("NT-41, §7c: the message", () => {
  it("is exactly the §7c JSON: generic text, string data, collapse keys, TTLs and APNs headers", () => {
    const box = newId();
    const token = fcmToken();
    expect(fcmMessage(token, { box, kind: "comment", count: 1 }, T0)).toEqual({
      message: {
        token,
        notification: { title: "Wants & Won'ts", body: "Something new in a conversation." },
        data: { box, kind: "comment", count: "1" },
        android: { collapse_key: box, priority: "normal", ttl: "86400s", notification: { tag: `box-${box}` } },
        apns: {
          headers: { "apns-collapse-id": box, "apns-priority": "5", "apns-expiration": String(T0 / 1000 + 86400) },
          payload: { aps: { "thread-id": box } },
        },
      },
    });
    expect(fcmMessage(token, { box, kind: "notes", count: 3 }, T0).message).toMatchObject({
      notification: { body: "3 new changes in a conversation." },
      data: { box, kind: "notes", count: "3" },
    });
    expect(fcmBody(1)).toBe("Something new in a conversation.");
    expect(fcmBody(2)).toBe("2 new changes in a conversation.");
  });
});

describe("§7c: what FCM answers (sendFcm)", () => {
  const box = newId();
  const payload = { box, kind: "notes" as const, count: 2 };

  const sendWith = async (answer: Parameters<ReturnType<typeof fakeGoogle>["answer"]>[1]) => {
    const google = fakeGoogle(SA);
    const loaded = await account();
    const auth = await fcmAccessToken(loaded, { fetch: google.fetch, nowMs: T0 });
    const token = fcmToken();
    google.answer(token, answer);
    const outcome = await sendFcm(loaded, (auth as { token: string }).token, token, payload, { fetch: google.fetch, nowMs: T0 });
    return { outcome, google, loaded };
  };

  const tokenViolation = { "@type": "type.googleapis.com/google.rpc.BadRequest", fieldViolations: [{ field: "message.token", description: "Invalid registration token" }] };
  const otherViolation = { "@type": "type.googleapis.com/google.rpc.BadRequest", fieldViolations: [{ field: "message.android.ttl", description: "Invalid duration" }] };

  it.each([
    ["200", 200, { result: "sent", status: 200, code: "sent" }],
    ["404 (UNREGISTERED)", { status: 404, body: fcmErrorBody(404, "NOT_FOUND", "UNREGISTERED") }, { result: "gone", status: 404, code: "push_gone" }],
    ["404 without a body", 404, { result: "gone", status: 404, code: "push_gone" }],
    ["400 UNREGISTERED", { status: 400, body: fcmErrorBody(400, "INVALID_ARGUMENT", "UNREGISTERED") }, { result: "gone", status: 400, code: "push_gone" }],
    [
      "400 INVALID_ARGUMENT about the token (field violation)",
      { status: 400, body: fcmErrorBody(400, "INVALID_ARGUMENT", "INVALID_ARGUMENT", [tokenViolation]) },
      { result: "gone", status: 400, code: "push_gone" },
    ],
    [
      "400 INVALID_ARGUMENT about the token (message)",
      { status: 400, body: fcmErrorBody(400, "INVALID_ARGUMENT", "INVALID_ARGUMENT", [], "The registration token is not a valid FCM registration token") },
      { result: "gone", status: 400, code: "push_gone" },
    ],
    [
      "400 INVALID_ARGUMENT about something else",
      { status: 400, body: fcmErrorBody(400, "INVALID_ARGUMENT", "INVALID_ARGUMENT", [otherViolation], "Invalid value at 'message.android.ttl'") },
      { result: "failed", status: 400, code: "push_failed" },
    ],
    ["400 other (SENDER_ID_MISMATCH... as 400)", { status: 400, body: fcmErrorBody(400, "FAILED_PRECONDITION", "SENDER_ID_MISMATCH") }, { result: "failed", status: 400, code: "push_failed" }],
    ["400 not JSON", { status: 400, body: "<html>" }, { result: "failed", status: 400, code: "push_failed" }],
    ["401", { status: 401, body: fcmErrorBody(401, "UNAUTHENTICATED", "THIRD_PARTY_AUTH_ERROR") }, { result: "auth", status: 401, code: "push_auth" }],
    ["403", { status: 403, body: fcmErrorBody(403, "PERMISSION_DENIED", "SENDER_ID_MISMATCH") }, { result: "auth", status: 403, code: "push_auth" }],
    ["429", { status: 429, body: fcmErrorBody(429, "RESOURCE_EXHAUSTED", "QUOTA_EXCEEDED") }, { result: "retry", status: 429, code: "push_retry" }],
    ["500", 500, { result: "retry", status: 500, code: "push_retry" }],
    ["503", { status: 503, body: fcmErrorBody(503, "UNAVAILABLE", "UNAVAILABLE") }, { result: "retry", status: 503, code: "push_retry" }],
    ["unreachable", "network", { result: "retry", status: 0, code: "push_unreachable" }],
    ["302 (not followed)", { status: 302, body: {} }, { result: "failed", status: 302, code: "push_failed" }],
    ["410", { status: 410, body: {} }, { result: "failed", status: 410, code: "push_failed" }],
  ] as const)("%s", async (_name, answer, outcome) => {
    expect((await sendWith(answer)).outcome).toEqual(outcome);
  });

  it("sends to the project's fixed URL with the bearer token, and a 401 forgets the cached token", async () => {
    const calls: string[] = [];
    const google = fakeGoogle(SA);
    const spying: FetchLike = (input, init) => {
      calls.push(input);
      return google.fetch(input, init);
    };
    const loaded = await account();
    const auth = (await fcmAccessToken(loaded, { fetch: spying, nowMs: T0 })) as { ok: true; token: string };
    const token = fcmToken();
    expect(await sendFcm(loaded, auth.token, token, payload, { fetch: spying, nowMs: T0 })).toMatchObject({ result: "sent" });
    const [sent] = google.delivered;
    expect(sent!.url).toBe(`https://fcm.googleapis.com/v1/projects/${SA.projectId}/messages:send`);
    expect(sent!.url).toBe(fcmSendUrl(SA.projectId));
    expect(sent!.headers.get("authorization")).toBe(`Bearer ${auth.token}`);
    expect(sent!.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(sent!.body).toEqual(fcmMessage(token, payload, T0));
    expect(calls).toEqual([FCM_TOKEN_URL, fcmSendUrl(SA.projectId)]);
    expect(loaded.token?.value).toBe(auth.token);

    google.state.revoked = true;
    expect(await sendFcm(loaded, auth.token, token, payload, { fetch: spying, nowMs: T0 })).toMatchObject({ result: "auth", status: 401 });
    expect(loaded.token).toBeNull();
  });

  it("refuses a malformed token rather than sending it", async () => {
    const loaded = await account();
    const never: FetchLike = () => Promise.reject(new Error("called"));
    await expect(sendFcm(loaded, "ya29.x", "a/b", payload, { fetch: never })).rejects.toThrow("bad FCM token");
  });
});

// ---- The routes and the Worker ------------------------------------------------------

type Box = Awaited<ReturnType<typeof liveBox>>;

const liveBox = async (guests = 0) => {
  const owner = await supporter();
  const box = await shareLive(owner);
  expect(box.response.status).toBe(201);
  const members: BoxDevice[] = [];
  for (let i = 0; i < guests; i++) {
    const guest = await BoxDevice.create();
    expect((await guest.join(box.boxId, box.join)).status).toBe(201);
    members.push(guest);
  }
  return { account: owner, ...box, members, versions: new Map<BoxDevice, number>() };
};

const subscribe = (device: BoxDevice, boxId: string, body: object | string, e: Env = FCM_ENV) =>
  device.fetch("POST", `/v1/boxes/${boxId}/subscriptions`, { body, env: e });

const app = (platform: "android" | "ios" = "android", token = fcmToken()) => ({ kind: "fcm", token, platform });

/** Registers an FCM token and returns its subId. */
const registered = async (device: BoxDevice, boxId: string, token = fcmToken(), platform: "android" | "ios" = "android", e: Env = FCM_ENV) => {
  const response = await subscribe(device, boxId, app(platform, token), e);
  expect(response.status).toBe(201);
  return ((await response.json()) as { subId: string }).subId;
};

const subscribedBrowser = async (device: BoxDevice, boxId: string, browser: PushBrowser, e: Env = FCM_ENV) => {
  const response = await subscribe(device, boxId, browser.subscription, e);
  expect(response.status).toBe(201);
  return ((await response.json()) as { subId: string }).subId;
};

const write = async (box: Box, device: BoxDevice, notify?: string, e: Env = FCM_ENV) => {
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

const runCron = async (cron: string, scheduledTime: number, e: Env = FCM_ENV) => {
  const ctx = createExecutionContext();
  await worker.scheduled(createScheduledController({ cron, scheduledTime }), e, ctx);
  await waitOnExecutionContext(ctx);
};
const pushCron = (at: number, e: Env = FCM_ENV) => runCron(PUSH_CRON, at, e);

type Row = {
  sub_id: string;
  box_id: string;
  member_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  kind: string;
  platform: string | null;
  last_sent_at: number | null;
  pending_kind: string | null;
  pending_count: number;
  sent_today: number;
};
const subRow = (subId: string) => env.DB.prepare("SELECT * FROM push_subs WHERE sub_id = ?").bind(subId).first<Row>();
const subCount = async (where: string, ...values: unknown[]) =>
  (await env.DB.prepare(`SELECT COUNT(*) AS n FROM push_subs WHERE ${where}`).bind(...values).first<{ n: number }>())?.n ?? 0;

/** Captures every console line. */
const captureLogs = () => {
  const lines: string[] = [];
  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      lines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
    });
  }
  return lines;
};

describe("§7c: POST /v1/boxes/:id/subscriptions with {kind: \"fcm\", token, platform}", () => {
  it("stores the token in endpoint with kind fcm and the platform, and answers 201 {subId}", async () => {
    const box = await liveBox(1);
    const token = fcmToken();
    const subId = await registered(box.members[0]!, box.boxId, token, "ios");
    expect(subId).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(await subRow(subId)).toMatchObject({
      box_id: box.boxId,
      member_id: box.members[0]!.memberId,
      endpoint: token,
      p256dh: "",
      auth: "",
      kind: "fcm",
      platform: "ios",
      last_sent_at: null,
      pending_count: 0,
    });
  });

  it("is idempotent per member device and token (the newest platform wins); another device's same token is its own", async () => {
    const box = await liveBox(1);
    const token = fcmToken();
    const first = await registered(box.host, box.boxId, token, "android");
    expect(await registered(box.host, box.boxId, token, "ios")).toBe(first);
    expect(await subRow(first)).toMatchObject({ platform: "ios" });
    expect(await subCount("box_id = ?", box.boxId)).toBe(1);
    expect(await registered(box.members[0]!, box.boxId, token)).not.toBe(first);
  });

  it("shares the 5-per-member-device limit with web push (409 too_many_subscriptions); an existing one still refreshes", async () => {
    const box = await liveBox();
    const tokens = [fcmToken(), fcmToken(), fcmToken()];
    for (const token of tokens) await registered(box.host, box.boxId, token);
    await subscribedBrowser(box.host, box.boxId, await PushBrowser.create());
    await subscribedBrowser(box.host, box.boxId, await PushBrowser.create());
    const over = await subscribe(box.host, box.boxId, app());
    expect(over.status).toBe(409);
    expect(await over.json()).toEqual({ error: "too_many_subscriptions", limit: PUSH_LIMITS.subscriptions });
    expect((await subscribe(box.host, box.boxId, (await PushBrowser.create()).subscription)).status).toBe(409);
    expect((await subscribe(box.host, box.boxId, app("ios", tokens[0]))).status).toBe(201);
    expect(await subCount("box_id = ?", box.boxId)).toBe(5);
  });

  it("accepts tokens of 1 to 4,096 characters of [A-Za-z0-9_:-]", async () => {
    const box = await liveBox();
    await registered(box.host, box.boxId, "x");
    await registered(box.host, box.boxId, "A".repeat(4096));
    await registered(box.host, box.boxId, "aZ09_:-");
    expect(await subCount("box_id = ? AND kind = 'fcm'", box.boxId)).toBe(3);
  });

  it("answers 400 bad_request for a malformed token, platform or kind", async () => {
    const box = await liveBox();
    for (const body of [
      { kind: "fcm" },
      { kind: "fcm", platform: "android" },
      { kind: "fcm", token: "", platform: "android" },
      { kind: "fcm", token: "A".repeat(4097), platform: "android" },
      { kind: "fcm", token: "abc/def", platform: "android" },
      { kind: "fcm", token: "abc.def", platform: "android" },
      { kind: "fcm", token: "abc def", platform: "android" },
      { kind: "fcm", token: "https://fcm.googleapis.com/fcm/send/abc", platform: "android" },
      { kind: "fcm", token: 12345, platform: "android" },
      { kind: "fcm", token: fcmToken() },
      { kind: "fcm", token: fcmToken(), platform: "web" },
      { kind: "fcm", token: fcmToken(), platform: "IOS" },
      { kind: "FCM", token: fcmToken(), platform: "ios" },
      { kind: "apns", token: fcmToken(), platform: "ios" },
      // A web push subscription marked as FCM is neither.
      { ...(await PushBrowser.create()).subscription, kind: "fcm" },
    ]) {
      const response = await subscribe(box.host, box.boxId, body);
      expect(response.status, JSON.stringify(body).slice(0, 100)).toBe(400);
      expect(await response.json()).toEqual({ error: "bad_request" });
    }
    expect(await subCount("box_id = ?", box.boxId)).toBe(0);
  });

  it("503 push_unavailable is per kind: FCM needs the service account, web push the VAPID keys", async () => {
    const box = await liveBox();
    const browser = await PushBrowser.create();
    const malformed: Env = { ...PUSH_ENV, FCM_SERVICE_ACCOUNT: JSON.stringify({ ...JSON.parse(SA.json), private_key: "nope" }) };
    for (const [e, fcm, webpush] of [
      [PUSH_ENV, 503, 201],
      [malformed, 503, 201],
      [FCM_ONLY, 201, 503],
      [env, 503, 503],
    ] as const) {
      const a = await subscribe(box.host, box.boxId, app(), e);
      expect(a.status).toBe(fcm);
      if (fcm === 503) expect(await a.json()).toEqual({ error: "push_unavailable" });
      const b = await subscribe(box.host, box.boxId, browser.subscription, e);
      expect(b.status).toBe(webpush);
      if (webpush === 503) expect(await b.json()).toEqual({ error: "push_unavailable" });
      await env.DB.prepare("DELETE FROM push_subs").run();
    }
    // The VAPID key route is web push's alone.
    expect((await handleRequest(new Request("https://sync.test/v1/push/key"), FCM_ONLY)).status).toBe(503);
    expect((await handleRequest(new Request("https://sync.test/v1/push/key"), FCM_ENV)).status).toBe(200);
  });

  it("DELETE …/subscriptions/:subId works for FCM, with or without the service account", async () => {
    const box = await liveBox();
    const a = await registered(box.host, box.boxId);
    const b = await registered(box.host, box.boxId);
    expect((await box.host.fetch("DELETE", `/v1/boxes/${box.boxId}/subscriptions/${a}`, { env: FCM_ENV })).status).toBe(204);
    expect((await box.host.fetch("DELETE", `/v1/boxes/${box.boxId}/subscriptions/${b}`, { env })).status).toBe(204);
    expect(await subCount("box_id = ?", box.boxId)).toBe(0);
  });
});

describe("NT-23, NT-40: a write tells every other member device, by web push and by FCM", () => {
  it("notifies web push and FCM subscribers of the other members, never the writer's, with the exact §7c message", async () => {
    const box = await liveBox(2);
    const [ana, ben] = box.members as [BoxDevice, BoxDevice];
    const anaPhone = fcmToken();
    const anaLaptop = await PushBrowser.create();
    const benPhone = fcmToken();
    const hostPhone = fcmToken();
    const hostLaptop = await PushBrowser.create();
    await registered(ana, box.boxId, anaPhone, "android");
    await subscribedBrowser(ana, box.boxId, anaLaptop);
    await registered(ben, box.boxId, benPhone, "ios");
    await registered(box.host, box.boxId, hostPhone, "ios");
    await subscribedBrowser(box.host, box.boxId, hostLaptop);
    const google = fakeGoogle(SA);
    const service = fakePushService([anaLaptop, hostLaptop], google.handle);

    const before = Math.floor(Date.now() / 1000);
    expect((await write(box, box.host, "comment")).status).toBe(200);
    const after = Math.ceil(Date.now() / 1000);

    expect(service.to(anaLaptop)).toEqual([{ box: box.boxId, kind: "comment", count: 1 }]);
    expect(service.to(hostLaptop)).toEqual([]);
    expect(google.delivered.map((d) => d.token).sort()).toEqual([anaPhone, benPhone].sort());
    expect(google.to(hostPhone)).toEqual([]);
    const accessToken = [...google.issued][0]!;
    for (const sent of google.delivered) {
      expect(sent.url).toBe(fcmSendUrl(SA.projectId));
      expect(sent.headers.get("authorization")).toBe(`Bearer ${accessToken}`);
      const expiration = Number((sent.body.message.apns as { headers: Record<string, string> }).headers["apns-expiration"]);
      expect(expiration).toBeGreaterThanOrEqual(before + 86400);
      expect(expiration).toBeLessThanOrEqual(after + 86400);
      // The whole message, and nothing else: no names, no text beyond the fixed lines, no other ids.
      expect(sent.body).toEqual({
        message: {
          token: sent.token,
          notification: { title: "Wants & Won'ts", body: "Something new in a conversation." },
          data: { box: box.boxId, kind: "comment", count: "1" },
          android: { collapse_key: box.boxId, priority: "normal", ttl: "86400s", notification: { tag: `box-${box.boxId}` } },
          apns: {
            headers: { "apns-collapse-id": box.boxId, "apns-priority": "5", "apns-expiration": String(expiration) },
            payload: { aps: { "thread-id": box.boxId } },
          },
        },
      });
      const raw = JSON.stringify(sent.body);
      for (const id of [box.host.memberId, ana.memberId, ben.memberId, box.account.accountId]) expect(raw).not.toContain(id);
    }
    // One token request for both sends.
    expect(google.assertions).toHaveLength(1);

    // Ben writes notes later: the host and Ana are told (both channels), Ben isn't.
    await env.DB.prepare("UPDATE push_subs SET last_sent_at = ? WHERE box_id = ?").bind(Date.now() - WINDOW_MS, box.boxId).run();
    expect((await write(box, ben, "notes")).status).toBe(200);
    expect(google.to(hostPhone)).toEqual([{ box: box.boxId, kind: "notes", count: "1" }]);
    expect(google.to(anaPhone)).toHaveLength(2);
    expect(google.to(benPhone)).toHaveLength(1);
    expect(service.to(hostLaptop)).toEqual([{ box: box.boxId, kind: "notes", count: 1 }]);
    // Still the one access token.
    expect(google.assertions).toHaveLength(1);
  });

  it("caches the access token across writes and crons, and gets a new one after it expires", async () => {
    const box = await liveBox(1);
    const tokens = [fcmToken(), fcmToken(), fcmToken()];
    for (const token of tokens) await registered(box.members[0]!, box.boxId, token);
    const google = fakeGoogle(SA);
    google.install();
    await write(box, box.host, "notes");
    for (let i = 0; i < 4; i++) await write(box, box.host, "notes");
    const now = Date.now();
    await pushCron(now + WINDOW_MS);
    expect(google.delivered).toHaveLength(6);
    expect(google.assertions).toHaveLength(1);
    expect(google.to(tokens[0]!)).toEqual([
      { box: box.boxId, kind: "notes", count: "1" },
      { box: box.boxId, kind: "notes", count: "4" },
    ]);
    expect(google.delivered[5]!.body.message.notification).toEqual({ title: "Wants & Won'ts", body: "4 new changes in a conversation." });

    // An hour later the token has expired: one new token for the next round.
    await write(box, box.host, "comment");
    await pushCron(now + 3600_000);
    expect(google.to(tokens[1]!)).toHaveLength(3);
    expect(google.assertions).toHaveLength(2);
  });
});

describe("NT-24 for FCM: the same 15-minute window, 20-a-day limit and cron", () => {
  it("holds changes inside the window and the cron sends them as one, comment beating notes", async () => {
    const box = await liveBox(1);
    const token = fcmToken();
    const subId = await registered(box.members[0]!, box.boxId, token, "ios");
    const google = fakeGoogle(SA);
    google.install();
    await write(box, box.host, "notes");
    const sentAt = (await subRow(subId))!.last_sent_at!;
    await write(box, box.host, "comment");
    await write(box, box.host, "notes");
    expect(await subRow(subId)).toMatchObject({ pending_count: 2, pending_kind: "comment" });
    await pushCron(sentAt + WINDOW_MS - 1);
    expect(google.delivered).toHaveLength(1);
    await pushCron(sentAt + WINDOW_MS);
    expect(google.to(token)).toEqual([
      { box: box.boxId, kind: "notes", count: "1" },
      { box: box.boxId, kind: "comment", count: "2" },
    ]);
    expect(await subRow(subId)).toMatchObject({ pending_count: 0, last_sent_at: sentAt + WINDOW_MS });
  });

  it("a concurrent second write never sends twice in one window", async () => {
    const box = await liveBox(2);
    const token = fcmToken();
    await registered(box.members[0]!, box.boxId, token);
    const google = fakeGoogle(SA);
    google.install();
    const ctx = createExecutionContext();
    await Promise.all([
      box.host.putCopy(box.boxId, record(100), {}, { notify: "notes" }, { env: FCM_ENV, ctx }),
      box.members[1]!.putCopy(box.boxId, record(100), {}, { notify: "comment" }, { env: FCM_ENV, ctx }),
    ]);
    await waitOnExecutionContext(ctx);
    const sent = google.to(token);
    expect(sent).toHaveLength(1);
    const row = (await env.DB.prepare("SELECT pending_count FROM push_subs WHERE box_id = ?").bind(box.boxId).first<{ pending_count: number }>())!;
    expect(Number(sent[0]!.count) + row.pending_count).toBe(2);
  });
});

describe("§7c: FCM's answers, through the Worker", () => {
  it.each([
    ["404", 404],
    ["400 UNREGISTERED", { status: 400, body: fcmErrorBody(400, "INVALID_ARGUMENT", "UNREGISTERED") }],
    [
      "400 INVALID_ARGUMENT about the token",
      {
        status: 400,
        body: fcmErrorBody(400, "INVALID_ARGUMENT", "INVALID_ARGUMENT", [
          { "@type": "type.googleapis.com/google.rpc.BadRequest", fieldViolations: [{ field: "message.token" }] },
        ]),
      },
    ],
  ] as const)("%s: the subscription is deleted at once", async (_name, answer) => {
    const box = await liveBox(1);
    const gone = fcmToken();
    const fine = fcmToken();
    const goneId = await registered(box.members[0]!, box.boxId, gone);
    const fineId = await registered(box.members[0]!, box.boxId, fine);
    const google = fakeGoogle(SA);
    google.install();
    google.answer(gone, answer);
    await write(box, box.host, "comment");
    expect(await subRow(goneId)).toBeNull();
    expect(await subRow(fineId)).toMatchObject({ pending_count: 0, sent_today: 1 });
  });

  it.each([
    ["400 other", { status: 400, body: fcmErrorBody(400, "INVALID_ARGUMENT", "INVALID_ARGUMENT", [], "Invalid JSON payload") }],
    ["400 SENDER_ID_MISMATCH", { status: 400, body: fcmErrorBody(400, "FAILED_PRECONDITION", "SENDER_ID_MISMATCH") }],
    ["410", 410],
  ] as const)("%s: logged and dropped like other 4xx for web push; the subscription stays", async (_name, answer) => {
    const lines = captureLogs();
    const box = await liveBox(1);
    const token = fcmToken();
    const subId = await registered(box.members[0]!, box.boxId, token);
    const google = fakeGoogle(SA);
    google.install();
    google.answer(token, answer);
    await write(box, box.host, "comment");
    expect(await subRow(subId)).toMatchObject({ pending_count: 0, sent_today: 1 });
    expect(lines.some((l) => l.includes("push_failed"))).toBe(true);
  });

  it("no answer at all: the change waits, but the window counts (it may have been delivered)", async () => {
    const box = await liveBox(1);
    const token = fcmToken();
    const subId = await registered(box.members[0]!, box.boxId, token);
    const google = fakeGoogle(SA);
    google.install();
    google.answer(token, "network");
    await write(box, box.host, "comment");
    const row = (await subRow(subId))!;
    expect(row).toMatchObject({ pending_count: 1, pending_kind: "comment", sent_today: 1 });
    if (row.last_sent_at === null) throw new Error("the window should count");
    google.answer(token, 200);
    const sentBefore = google.delivered.length;
    await pushCron(row.last_sent_at + FLUSH_EVERY_MS);
    expect(google.delivered.length).toBe(sentBefore);
    await pushCron(row.last_sent_at + WINDOW_MS);
    expect(google.delivered.at(-1)!.body.message.data).toEqual({ box: box.boxId, kind: "comment", count: "1" });
    expect(await subRow(subId)).toMatchObject({ pending_count: 0 });
  });

  it.each([429, 500, 503] as const)("%s: the change waits, and the 5-minute cron sends it", async (answer) => {
    const box = await liveBox(1);
    const token = fcmToken();
    const subId = await registered(box.members[0]!, box.boxId, token);
    const google = fakeGoogle(SA);
    google.install();
    google.answer(token, answer);
    await write(box, box.host, "comment");
    expect(await subRow(subId)).toMatchObject({ pending_count: 1, pending_kind: "comment", last_sent_at: null, sent_today: 0 });
    await write(box, box.host, "notes");
    await pushCron(Date.now() + FLUSH_EVERY_MS);
    expect(await subRow(subId)).toMatchObject({ pending_count: 2, last_sent_at: null });

    google.answer(token, 200);
    const at = Date.now() + 2 * FLUSH_EVERY_MS;
    await pushCron(at);
    expect(google.delivered.at(-1)!.body.message.data).toEqual({ box: box.boxId, kind: "comment", count: "2" });
    expect(await subRow(subId)).toMatchObject({ pending_count: 0, last_sent_at: at, sent_today: 1 });
  });

  it.each([401, 403] as const)("%i: kept waiting and logged as push_auth, so a broken service account drops nobody", async (status) => {
    const lines = captureLogs();
    const box = await liveBox(1);
    const token = fcmToken();
    const subId = await registered(box.members[0]!, box.boxId, token);
    const google = fakeGoogle(SA);
    google.install();
    if (status === 401) google.state.revoked = true;
    else google.answer(token, { status: 403, body: fcmErrorBody(403, "PERMISSION_DENIED", "PERMISSION_DENIED") });
    await write(box, box.host, "notes");
    expect(await subRow(subId)).toMatchObject({ pending_count: 1, last_sent_at: null, sent_today: 0 });
    expect(lines.map((l) => JSON.parse(l) as Record<string, unknown>)).toContainEqual({ route: "push fcm", status, code: "push_auth" });
    await pushCron(Date.now() + FLUSH_EVERY_MS);
    expect(await subRow(subId)).toMatchObject({ pending_count: 1, last_sent_at: null });
    // A 401 makes the Worker get a new access token next time; a 403 doesn't.
    expect(google.assertions).toHaveLength(status === 401 ? 2 : 1);

    google.state.revoked = false;
    google.answer(token, 200);
    await pushCron(Date.now() + 2 * FLUSH_EVERY_MS);
    expect(await subRow(subId)).toMatchObject({ pending_count: 0, sent_today: 1 });
    expect(google.to(token).at(-1)).toEqual({ box: box.boxId, kind: "notes", count: "1" });
  });

  it("without an access token (the token endpoint fails), every FCM send waits, logged once; web push goes on", async () => {
    const lines = captureLogs();
    const box = await liveBox(1);
    const tokens = [fcmToken(), fcmToken()];
    const subIds = [await registered(box.members[0]!, box.boxId, tokens[0]), await registered(box.members[0]!, box.boxId, tokens[1])];
    const browser = await PushBrowser.create();
    await subscribedBrowser(box.members[0]!, box.boxId, browser);
    const google = fakeGoogle(SA);
    const service = fakePushService([browser], google.handle);
    google.state.tokenAnswer = 503;
    await write(box, box.host, "comment");
    expect(service.to(browser)).toHaveLength(1);
    expect(google.delivered).toHaveLength(0);
    for (const subId of subIds) expect(await subRow(subId)).toMatchObject({ pending_count: 1, last_sent_at: null });
    const tokenLines = lines.filter((l) => l.includes("push fcm token"));
    expect(tokenLines.map((l) => JSON.parse(l) as unknown)).toEqual([
      { route: "push fcm token", status: 503, code: "push_retry", subscriptions: 2 },
    ]);

    google.state.tokenAnswer = 400;
    await pushCron(Date.now() + FLUSH_EVERY_MS);
    expect(lines.some((l) => l.includes('"push fcm token"') && l.includes("push_auth"))).toBe(true);
    google.state.tokenAnswer = null;
    await pushCron(Date.now() + 2 * FLUSH_EVERY_MS);
    expect(google.delivered.map((d) => d.token).sort()).toEqual([...tokens].sort());
  });

  it("only the two fixed Google addresses are ever called for FCM", async () => {
    const box = await liveBox(1);
    for (let i = 0; i < 3; i++) await registered(box.members[0]!, box.boxId);
    const google = fakeGoogle(SA);
    const spy = google.install();
    await write(box, box.host, "notes");
    await pushCron(Date.now() + DAY_MS);
    const urls = new Set(spy.mock.calls.map(([input]) => new Request(input as RequestInfo).url));
    expect([...urls].sort()).toEqual([FCM_TOKEN_URL, fcmSendUrl(SA.projectId)].sort());
  });
});

describe("§7c: a channel without credentials leaves its subscriptions waiting", () => {
  it("FCM rows wait while the service account is missing, and go out once it's back", async () => {
    const lines = captureLogs();
    const box = await liveBox(1);
    const token = fcmToken();
    const subId = await registered(box.members[0]!, box.boxId, token);
    const browser = await PushBrowser.create();
    await subscribedBrowser(box.members[0]!, box.boxId, browser);
    const google = fakeGoogle(SA);
    const service = fakePushService([browser], google.handle);

    // Web push only: the browser is told, the app's change waits.
    await write(box, box.host, "comment", PUSH_ENV);
    expect(service.to(browser)).toHaveLength(1);
    expect(google.assertions).toHaveLength(0);
    expect(await subRow(subId)).toMatchObject({ pending_count: 1, pending_kind: "comment", last_sent_at: null });
    await pushCron(Date.now() + FLUSH_EVERY_MS, PUSH_ENV);
    expect(await subRow(subId)).toMatchObject({ pending_count: 1, last_sent_at: null });
    // A malformed service account is the same as none.
    const malformed: Env = { ...PUSH_ENV, FCM_SERVICE_ACCOUNT: "{" };
    await pushCron(Date.now() + 2 * FLUSH_EVERY_MS, malformed);
    expect(google.delivered).toHaveLength(0);
    // Not an attempt that failed: nothing was claimed, tried or logged for it.
    expect(lines.filter((l) => l.includes("push fcm"))).toEqual([]);

    await pushCron(Date.now() + 3 * FLUSH_EVERY_MS, FCM_ENV);
    expect(google.to(token)).toEqual([{ box: box.boxId, kind: "comment", count: "1" }]);
    expect(await subRow(subId)).toMatchObject({ pending_count: 0, sent_today: 1 });
  });

  it("web push rows wait while the VAPID keys are missing, and go out once they're back", async () => {
    const box = await liveBox(1);
    const browser = await PushBrowser.create();
    const browserId = await subscribedBrowser(box.members[0]!, box.boxId, browser);
    const token = fcmToken();
    await registered(box.members[0]!, box.boxId, token);
    const google = fakeGoogle(SA);
    const service = fakePushService([browser], google.handle);

    await write(box, box.host, "notes", FCM_ONLY);
    expect(google.to(token)).toHaveLength(1);
    expect(service.delivered).toHaveLength(0);
    expect(await subRow(browserId)).toMatchObject({ pending_count: 1, last_sent_at: null });
    await pushCron(Date.now() + FLUSH_EVERY_MS, FCM_ONLY);
    expect(service.delivered).toHaveLength(0);
    await pushCron(Date.now() + 2 * FLUSH_EVERY_MS, FCM_ENV);
    expect(service.to(browser)).toEqual([{ box: box.boxId, kind: "notes", count: 1 }]);
  });

  it("a stored token that isn't well-formed is deleted, never sent", async () => {
    const box = await liveBox(1);
    const subId = newId();
    await env.DB.prepare(
      `INSERT INTO push_subs (sub_id, box_id, member_id, endpoint, p256dh, auth, created_at, kind, platform, pending_count, pending_kind)
       VALUES (?, ?, ?, 'https://evil.test/x', '', '', ?, 'fcm', 'android', 1, 'notes')`
    )
      .bind(subId, box.boxId, box.members[0]!.memberId, Date.now())
      .run();
    const google = fakeGoogle(SA);
    const spy = google.install();
    await pushCron(Date.now());
    expect(spy).not.toHaveBeenCalled();
    expect(await subRow(subId)).toBeNull();
  });

  it("the database refuses an unknown kind or platform", async () => {
    const insert = (kind: string, platform: string | null) =>
      env.DB.prepare(
        "INSERT INTO push_subs (sub_id, box_id, member_id, endpoint, p256dh, auth, created_at, kind, platform) VALUES (?, ?, ?, ?, '', '', 0, ?, ?)"
      )
        .bind(newId(), newId(), newId(), fcmToken(), kind, platform)
        .run();
    await expect(insert("apns", null)).rejects.toThrow();
    await expect(insert("fcm", "web")).rejects.toThrow();
    await insert("fcm", "ios");
    // Rows from before the migration are web push.
    const old = newId();
    await env.DB.prepare("INSERT INTO push_subs (sub_id, box_id, member_id, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, 'k', 'a', 0)")
      .bind(old, newId(), newId(), "https://fcm.googleapis.com/fcm/send/x")
      .run();
    expect(await subRow(old)).toMatchObject({ kind: "webpush", platform: null });
  });
});

describe("NT-56: FCM subscriptions go with their member device and box", () => {
  it("leaving deletes the leaving device's FCM tokens, and only those", async () => {
    const box = await liveBox(2);
    const [ana, ben] = box.members as [BoxDevice, BoxDevice];
    await registered(ana, box.boxId);
    await subscribedBrowser(ana, box.boxId, await PushBrowser.create());
    const kept = await registered(ben, box.boxId);
    expect((await ana.fetch("DELETE", `/v1/boxes/${box.boxId}/members/me`)).status).toBe(204);
    expect(await subCount("box_id = ? AND member_id = ?", box.boxId, ana.memberId)).toBe(0);
    expect(await subRow(kept)).not.toBeNull();
  });

  it("Stop sharing and account deletion delete the box's FCM tokens", async () => {
    const box = await liveBox(1);
    const other = await liveBox(1);
    await registered(box.members[0]!, box.boxId);
    await registered(box.host, box.boxId);
    const kept = await registered(other.members[0]!, other.boxId);
    expect((await box.host.fetch("DELETE", `/v1/boxes/${box.boxId}`)).status).toBe(204);
    expect(await subCount("box_id = ?", box.boxId)).toBe(0);
    expect(await subRow(kept)).not.toBeNull();
    expect((await other.account.fetch("DELETE", "/v1/account")).status).toBe(204);
    expect(await subRow(kept)).toBeNull();
  });

  it("the daily cron deletes FCM tokens whose member device or box is gone", async () => {
    const box = await liveBox(1);
    const kept = await registered(box.members[0]!, box.boxId);
    const orphan = newId();
    await env.DB.prepare(
      "INSERT INTO push_subs (sub_id, box_id, member_id, endpoint, p256dh, auth, created_at, kind, platform) VALUES (?, ?, ?, ?, '', '', 0, 'fcm', 'ios')"
    )
      .bind(orphan, box.boxId, newId(), fcmToken())
      .run();
    await runCron("17 3 * * *", Date.now());
    expect(await subRow(orphan)).toBeNull();
    expect(await subRow(kept)).not.toBeNull();
  });
});

describe("NT-51 / SY-44: nothing about FCM reaches the logs but route, status and code", () => {
  it("logs no tokens, project ids, emails, keys, access tokens or ids", async () => {
    const lines = captureLogs();
    const box = await liveBox(2);
    const [ana, ben] = box.members as [BoxDevice, BoxDevice];
    const tokens = { gone: fcmToken(), failing: fcmToken(), unreachable: fcmToken(), rejected: fcmToken(), auth: fcmToken(), fine: fcmToken() };
    const subIds = [
      await registered(ana, box.boxId, tokens.gone),
      await registered(ana, box.boxId, tokens.failing),
      await registered(ana, box.boxId, tokens.unreachable),
      await registered(ben, box.boxId, tokens.rejected),
      await registered(ben, box.boxId, tokens.auth, "ios"),
      await registered(ben, box.boxId, tokens.fine, "ios"),
    ];
    const google = fakeGoogle(SA);
    google.install();
    google.answer(tokens.gone, { status: 400, body: fcmErrorBody(400, "INVALID_ARGUMENT", "UNREGISTERED", [], `token ${tokens.gone}`) });
    google.answer(tokens.failing, 503);
    google.answer(tokens.unreachable, "network");
    google.answer(tokens.rejected, { status: 400, body: fcmErrorBody(400, "INVALID_ARGUMENT", "INVALID_ARGUMENT", [], `bad ${SA.projectId}`) });
    google.answer(tokens.auth, { status: 403, body: fcmErrorBody(403, "PERMISSION_DENIED", "SENDER_ID_MISMATCH", [], SA.clientEmail) });
    await subscribe(ana, box.boxId, { kind: "fcm", token: `${tokens.fine}/x`, platform: "ios" });
    await subscribe(ana, box.boxId, app("ios", tokens.fine), PUSH_ENV);
    await write(box, box.host, "comment");
    google.state.tokenAnswer = 500;
    resetFcmCache();
    await write(box, ana, "notes");
    google.state.tokenAnswer = null;
    await pushCron(Date.now() + DAY_MS);
    await ben.fetch("DELETE", `/v1/boxes/${box.boxId}/subscriptions/${subIds[5]}`, { env: FCM_ENV });
    await runCron("17 3 * * *", Date.now());

    const everything = lines.join("\n");
    for (const code of ["push_gone", "push_retry", "push_unreachable", "push_failed", "push_auth"]) expect(everything).toContain(code);
    expect(google.to(tokens.fine).length).toBeGreaterThan(0);
    const pemLines = SA.privateKeyPem.split("\n").filter((l) => l.length > 20 && !l.startsWith("-----"));
    const secrets = [
      ...Object.values(tokens),
      SA.projectId,
      SA.clientEmail,
      ...pemLines,
      ...google.issued,
      "ya29",
      "Bearer",
      box.boxId,
      box.host.memberId,
      ana.memberId,
      ben.memberId,
      ...subIds,
      `"box":`,
      "new changes",
      "Something new",
    ];
    for (const secret of secrets) expect(everything).not.toContain(secret);
    for (const line of lines) {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      expect(Object.keys(parsed)).toEqual(expect.arrayContaining(["route", "status", "code"]));
      expect(String(parsed.route)).not.toMatch(/[A-Za-z0-9_-]{22}/);
    }
  });
});
