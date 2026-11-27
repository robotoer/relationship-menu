/**
 * Test helpers. `Device` signs requests exactly as the app will (SY-6), and
 * `BoxDevice` signs live-sharing box requests (notifications.md §7a), so these
 * tests double as the reference for the client's implementation.
 */

import { env } from "cloudflare:workers";
import { vi } from "vitest";
import { PROTOCOL, canonicalBoxRequest, canonicalRequest } from "../src/auth";
import { concat, fromBase64Url, sha256, toBase64Url, toHex, utf8 } from "../src/bytes";
import { handleRequest } from "../src/index";
import type { Env } from "../src/env";
import { FCM_SCOPE, FCM_TOKEN_URL, fcmSendUrl } from "../src/fcm";
import { deriveKeys, ecdh } from "../src/webpush";

export { env };

export class Device {
  private constructor(
    readonly keys: CryptoKeyPair,
    readonly publicKey: Uint8Array,
    readonly accountId: string
  ) {}

  static async create(): Promise<Device> {
    const keys = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
    const publicKey = new Uint8Array((await crypto.subtle.exportKey("raw", keys.publicKey)) as ArrayBuffer);
    const accountId = toBase64Url((await sha256(publicKey)).slice(0, 16));
    return new Device(keys, publicKey, accountId);
  }

  async signBytes(message: Uint8Array): Promise<Uint8Array> {
    return new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, this.keys.privateKey, message));
  }

  async authorization(method: string, pathAndQuery: string, body: Uint8Array, ts = Math.floor(Date.now() / 1000)) {
    const message = canonicalRequest(method, pathAndQuery, ts, toBase64Url(await sha256(body)));
    const sig = toBase64Url(await this.signBytes(utf8(message)));
    return `MenuSync v1 account=${this.accountId}, key=${toBase64Url(this.publicKey)}, ts=${ts}, sig=${sig}`;
  }

  /** Sends a signed request to the Worker. */
  async fetch(
    method: string,
    pathAndQuery: string,
    options: { body?: Uint8Array | string | object; headers?: Record<string, string>; ts?: number; env?: Env } = {}
  ): Promise<Response> {
    const body = toBody(options.body);
    const headers = new Headers(options.headers);
    headers.set("authorization", await this.authorization(method, pathAndQuery, body, options.ts));
    const request = new Request(`https://sync.test${pathAndQuery}`, { method, headers, body: body.length ? body : undefined });
    return options.env ? handleRequest(request, options.env) : call(request);
  }
}

/**
 * A device's box key (NT-12): its own Ed25519 key pair, separate from any sync
 * code. It signs every member request with
 *
 *   Authorization: MenuBox v1 box=<boxId>, key=<base64url public key>, ts=<seconds>, sig=<base64url signature>
 *
 * where sig is Ed25519 over `menu-box/v1`, METHOD, path with query, ts and
 * base64url(SHA-256(body)), joined by "\n".
 */
export class BoxDevice {
  private constructor(
    readonly keys: CryptoKeyPair,
    readonly publicKey: Uint8Array,
    /** base64url(first 16 bytes of SHA-256(public key)). */
    readonly memberId: string
  ) {}

  static async create(): Promise<BoxDevice> {
    const keys = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
    const publicKey = new Uint8Array((await crypto.subtle.exportKey("raw", keys.publicKey)) as ArrayBuffer);
    const memberId = toBase64Url((await sha256(publicKey)).slice(0, 16));
    return new BoxDevice(keys, publicKey, memberId);
  }

  get key(): string {
    return toBase64Url(this.publicKey);
  }

  async authorization(
    method: string,
    pathAndQuery: string,
    boxId: string,
    body: Uint8Array,
    ts = Math.floor(Date.now() / 1000)
  ) {
    const message = canonicalBoxRequest(method, pathAndQuery, ts, toBase64Url(await sha256(body)));
    const sig = toBase64Url(new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, this.keys.privateKey, utf8(message))));
    return `MenuBox v1 box=${boxId}, key=${this.key}, ts=${ts}, sig=${sig}`;
  }

  /** Sends a signed request; the box is the one in the path unless `boxId` says otherwise. */
  async fetch(
    method: string,
    pathAndQuery: string,
    options: {
      body?: Uint8Array | string | object;
      headers?: Record<string, string>;
      ts?: number;
      boxId?: string;
      env?: Env;
      /** Collects work left running after the response (createExecutionContext). */
      ctx?: Pick<ExecutionContext, "waitUntil">;
    } = {}
  ): Promise<Response> {
    const body = toBody(options.body);
    const boxId = options.boxId ?? pathAndQuery.match(/^\/v1\/boxes\/([^/?]+)/)?.[1] ?? "";
    const headers = new Headers(options.headers);
    headers.set("authorization", await this.authorization(method, pathAndQuery, boxId, body, options.ts));
    const request = new Request(`https://sync.test${pathAndQuery}`, { method, headers, body: body.length ? body : undefined });
    return handleRequest(request, options.env ?? env, options.ctx);
  }

  /**
   * Joins with the box's join secret J (unsigned, NT-12). Joins are limited per
   * IP (NT-52), so each comes from a random test address unless `ip` is given.
   */
  join(boxId: string, join: Uint8Array, ip = `10.${crypto.getRandomValues(new Uint8Array(3)).join(".")}`) {
    return call(
      new Request(`https://sync.test/v1/boxes/${boxId}/members`, {
        method: "POST",
        headers: { "cf-connecting-ip": ip },
        body: JSON.stringify({ key: this.key, join: toBase64Url(join) }),
      })
    );
  }

  /** PUT this device's copy. */
  putCopy(
    boxId: string,
    ciphertext: Uint8Array,
    precondition: { version?: number } = {},
    headers: Record<string, string> = {},
    options: { env?: Env; ctx?: Pick<ExecutionContext, "waitUntil"> } = {}
  ) {
    return this.fetch("PUT", `/v1/boxes/${boxId}/copies/${this.memberId}`, {
      ...options,
      body: ciphertext,
      headers: {
        ...(precondition.version === undefined ? { "if-none-match": "*" } : { "if-match": `"${precondition.version}"` }),
        "content-type": "application/octet-stream",
        ...headers,
      },
    });
  }
}

/** A supporter shares a conversation live (NT-10): a new box, with its host device. */
export const shareLive = async (account: Device, options: { boxId?: string; join?: Uint8Array; host?: BoxDevice } = {}) => {
  const boxId = options.boxId ?? newId();
  const join = options.join ?? crypto.getRandomValues(new Uint8Array(32));
  const host = options.host ?? (await BoxDevice.create());
  const response = await account.fetch("POST", "/v1/boxes", {
    body: { boxId, joinHash: toBase64Url(await sha256(join)), hostKey: host.key },
  });
  return { boxId, join, host, response };
};

const toBody = (body: Uint8Array | string | object | undefined): Uint8Array => {
  if (body === undefined) return new Uint8Array();
  if (body instanceof Uint8Array) return body;
  return utf8(typeof body === "string" ? body : JSON.stringify(body));
};

/** Calls the Worker's request handler directly, in this isolate. */
export const call = (request: Request) => handleRequest(request, env);

export const unsigned = (method: string, path: string, init: RequestInit = {}) =>
  call(new Request(`https://sync.test${path}`, { method, ...init }));

/** A fake encrypted record: random bytes, optionally starting with a marker. */
export const record = (size = 200, marker?: string): Uint8Array => {
  const bytes = new Uint8Array(size);
  // getRandomValues fills at most 64 KiB per call.
  for (let offset = 0; offset < size; offset += 65536) {
    crypto.getRandomValues(bytes.subarray(offset, Math.min(size, offset + 65536)));
  }
  if (marker) bytes.set(utf8(marker).slice(0, size));
  return bytes;
};

/** Creates an account row directly, as a completed checkout would. */
export const seedAccount = async (
  accountId: string,
  status: "active" | "past_due" | "lifetime" | "lapsed" = "active",
  extra: Partial<{
    plan: string;
    stripe_customer_id: string;
    stripe_subscription_id: string;
    lapsed_at: number;
    paid_through: number;
  }> = {}
) => {
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO accounts (account_id, status, plan, stripe_customer_id, stripe_subscription_id, paid_through,
       lapsed_at, created_at, updated_at, seq, purged_seq)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)`
  )
    .bind(
      accountId,
      status,
      extra.plan ?? (status === "lifetime" ? "supporter_30_lifetime" : "supporter_12_yearly"),
      extra.stripe_customer_id ?? null,
      extra.stripe_subscription_id ?? null,
      extra.paid_through ?? null,
      extra.lapsed_at ?? (status === "lapsed" ? now : null),
      now,
      now
    )
    .run();
};

export const accountRow = (accountId: string) =>
  env.DB.prepare("SELECT * FROM accounts WHERE account_id = ?").bind(accountId).first<Record<string, unknown>>();

/** Creates a supporter device with an account. */
export const supporter = async (status: Parameters<typeof seedAccount>[1] = "active") => {
  const device = await Device.create();
  await seedAccount(device.accountId, status);
  return device;
};

/** PUT a new menu; returns its id and the server's reply. */
export const createMenu = async (device: Device, ciphertext = record()) => {
  const id = toBase64Url(crypto.getRandomValues(new Uint8Array(16)));
  const response = await device.fetch("PUT", `/v1/menus/${id}`, { body: ciphertext, headers: { "if-none-match": "*" } });
  return { id, response, body: (await response.json()) as { version: number; seq: number } };
};

export const newId = () => toBase64Url(crypto.getRandomValues(new Uint8Array(16)));

// ---- Stripe -------------------------------------------------------------------

export type StripeCall = { method: string; path: string; params: URLSearchParams; headers: Headers };

/**
 * Replaces fetch() for api.stripe.com. `handlers` map "METHOD /path" (prefix match)
 * to a JSON response. Every call is recorded. Anything else fails the test.
 */
export const mockStripe = (handlers: Record<string, (call: StripeCall) => unknown>) => {
  const calls: StripeCall[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = new Request(input as RequestInfo, init);
    const url = new URL(request.url);
    if (url.hostname !== "api.stripe.com") throw new Error(`Unexpected fetch to ${url.hostname}`);
    const body = request.method === "GET" ? url.search.slice(1) : new TextDecoder().decode(await request.arrayBuffer());
    const call: StripeCall = { method: request.method, path: url.pathname, params: new URLSearchParams(body), headers: request.headers };
    calls.push(call);
    const key = Object.keys(handlers)
      .filter((k) => `${call.method} ${call.path}`.startsWith(k))
      .sort((a, b) => b.length - a.length)[0];
    if (!key) return new Response(JSON.stringify({ error: { message: "not mocked" } }), { status: 404 });
    return new Response(JSON.stringify(handlers[key]!(call)), { headers: { "content-type": "application/json" } });
  });
  return calls;
};

export const WEBHOOK_SECRET = "whsec_test_fake";

/** Builds a webhook request signed the way Stripe signs them. */
export const webhookRequest = async (event: object, options: { secret?: string; ts?: number } = {}) => {
  const payload = JSON.stringify(event);
  const ts = options.ts ?? Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey(
    "raw",
    utf8(options.secret ?? WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = toHex(new Uint8Array(await crypto.subtle.sign("HMAC", key, concat(utf8(`${ts}.`), utf8(payload)))));
  return new Request("https://sync.test/v1/stripe/webhook", {
    method: "POST",
    headers: { "stripe-signature": `t=${ts},v1=${signature}`, "content-type": "application/json" },
    body: payload,
  });
};

/** A Stripe subscription object in the shape of API version 2025-03-31.basil. */
export const subscription = (
  over: Partial<{ id: string; status: string; customer: string; account_id: string; lookup_key: string; period_end: number; canceled_at: number; ended_at: number; cancel_at_period_end: boolean }> = {}
) => ({
  id: over.id ?? "sub_test_1",
  object: "subscription",
  status: over.status ?? "active",
  customer: over.customer ?? "cus_test_1",
  metadata: over.account_id ? { account_id: over.account_id, plan: over.lookup_key ?? "supporter_12_yearly" } : {},
  canceled_at: over.canceled_at ?? null,
  ended_at: over.ended_at ?? null,
  cancel_at_period_end: over.cancel_at_period_end ?? false,
  items: {
    data: [
      {
        current_period_end: over.period_end ?? Math.floor(Date.now() / 1000) + 365 * 24 * 3600,
        price: { id: "price_test_12", lookup_key: over.lookup_key ?? "supporter_12_yearly" },
      },
    ],
  },
});

export const event = (type: string, object: object, id = `evt_${newId()}`) => ({
  id,
  object: "event",
  type,
  api_version: "2025-03-31.basil",
  data: { object },
});

export { PROTOCOL };

// ---- Web push (notifications.md §7b) ----------------------------------------------

/** A fresh VAPID key pair in the secrets' format: 65-byte public point and 32-byte d, base64url. */
export const vapidKeys = async () => {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey("jwk", pair.privateKey)) as JsonWebKey;
  const publicKey = concat(new Uint8Array([0x04]), fromBase64Url(jwk.x!)!, fromBase64Url(jwk.y!)!);
  return { publicKey: toBase64Url(publicKey), privateKey: jwk.d!, verifyKey: pair.publicKey };
};

export const VAPID = await vapidKeys();
export const VAPID_SUBJECT = "mailto:push@wantsandwonts.example";

/** The test Worker's bindings with push turned on. */
export const PUSH_ENV: Env = {
  ...env,
  VAPID_PUBLIC_KEY: VAPID.publicKey,
  VAPID_PRIVATE_KEY: VAPID.privateKey,
  VAPID_SUBJECT,
};

/**
 * A browser's push subscription (what `PushManager.subscribe` gives the app):
 * its endpoint on a push service, its P-256 key pair and auth secret. It can
 * decrypt what's pushed to it, as the browser would (RFC 8291).
 */
export class PushBrowser {
  private constructor(
    readonly endpoint: string,
    readonly keys: CryptoKeyPair,
    readonly publicKey: Uint8Array,
    readonly authSecret: Uint8Array
  ) {}

  static async create(host = "fcm.googleapis.com"): Promise<PushBrowser> {
    const keys = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
    const publicKey = new Uint8Array((await crypto.subtle.exportKey("raw", keys.publicKey)) as ArrayBuffer);
    return new PushBrowser(`https://${host}/fcm/send/${newId()}${newId()}`, keys, publicKey, crypto.getRandomValues(new Uint8Array(16)));
  }

  /** The body of POST /v1/boxes/:id/subscriptions. */
  get subscription() {
    return { endpoint: this.endpoint, p256dh: toBase64Url(this.publicKey), auth: toBase64Url(this.authSecret) };
  }

  /** Decrypts an `aes128gcm` body (RFC 8188 header, one record) to its plaintext. */
  async decrypt(body: Uint8Array): Promise<string> {
    const salt = body.slice(0, 16);
    const rs = new DataView(body.buffer, body.byteOffset).getUint32(16);
    const idlen = body[20]!;
    const senderKey = body.slice(21, 21 + idlen);
    const record = body.slice(21 + idlen);
    if (rs !== 4096 || idlen !== 65 || record.length > rs) throw new Error("bad aes128gcm header");
    const { cek, nonce } = await deriveKeys(await ecdh(this.keys.privateKey, senderKey), this.authSecret, this.publicKey, senderKey, salt);
    const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
    const padded = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, record));
    // The last record: data, then 0x02, then optional zero padding.
    let end = padded.length - 1;
    while (end >= 0 && padded[end] === 0) end--;
    if (padded[end] !== 0x02) throw new Error("bad padding delimiter");
    return new TextDecoder().decode(padded.slice(0, end));
  }
}

export type Delivered = { browser: PushBrowser; headers: Headers; plaintext: string; status: number };

/**
 * Replaces fetch() with push services that know `browsers`: each push is
 * decrypted with the receiving browser's keys and recorded. `answer` sets what
 * an endpoint replies (a status, or "network" for a failed connection); 201 by
 * default. A call to anything else fails the test.
 */
export const fakePushService = (browsers: PushBrowser[], others?: (request: Request) => Promise<Response>) => {
  const delivered: Delivered[] = [];
  const answers = new Map<string, number | "network">();
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = new Request(input as RequestInfo, init);
    const browser = browsers.find((b) => b.endpoint === request.url);
    // Anything else goes to `others` (e.g. fakeGoogle's handler), if given.
    if (!browser && others) return others(request);
    if (!browser) throw new Error("Unexpected fetch");
    const answer = answers.get(browser.endpoint) ?? 201;
    if (answer === "network") throw new TypeError("Network connection lost.");
    const plaintext = await browser.decrypt(new Uint8Array(await request.arrayBuffer()));
    delivered.push({ browser, headers: request.headers, plaintext, status: answer });
    return new Response(null, { status: answer });
  });
  return {
    delivered,
    spy,
    answer: (browser: PushBrowser, status: number | "network") => answers.set(browser.endpoint, status),
    /** What was pushed to `browser`, parsed. */
    to: (browser: PushBrowser) => delivered.filter((d) => d.browser === browser).map((d) => JSON.parse(d.plaintext) as unknown),
  };
};

// ---- FCM (notifications.md §7c) --------------------------------------------------------

export type TestServiceAccount = {
  /** The JSON key, as stored in the FCM_SERVICE_ACCOUNT secret. */
  json: string;
  projectId: string;
  clientEmail: string;
  privateKeyPem: string;
  verifyKey: CryptoKey;
};

const pem = (der: Uint8Array) => {
  let binary = "";
  for (const byte of der) binary += String.fromCharCode(byte);
  const lines = btoa(binary).match(/.{1,64}/g)!.join("\n");
  return `-----BEGIN PRIVATE KEY-----\n${lines}\n-----END PRIVATE KEY-----\n`;
};

/**
 * A Google service account made in the test: a fresh RSA 2048 key pair and a
 * JSON key shaped like the one the Google Cloud console downloads.
 */
export const makeServiceAccount = async (projectId = "wants-test-1a2b3", over: Record<string, unknown> = {}) => {
  const pair = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"]
  )) as CryptoKeyPair;
  const privateKeyPem = pem(new Uint8Array((await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer));
  const clientEmail = `fcm-sender@${projectId}.iam.gserviceaccount.com`;
  const json = JSON.stringify({
    type: "service_account",
    project_id: projectId,
    private_key_id: toHex(crypto.getRandomValues(new Uint8Array(20))),
    private_key: privateKeyPem,
    client_email: clientEmail,
    client_id: "100000000000000000001",
    auth_uri: "https://accounts.google.com/o/oauth2/auth",
    token_uri: FCM_TOKEN_URL,
    ...over,
  });
  return { json, projectId, clientEmail, privateKeyPem, verifyKey: pair.publicKey } satisfies TestServiceAccount;
};

let sharedAccount: Promise<TestServiceAccount> | null = null;
/** One service account per test file (RSA key generation is slow). */
export const serviceAccount = () => (sharedAccount ??= makeServiceAccount());

/** An FCM registration token, shaped like a real one. */
export const fcmToken = () => `${newId()}:APA91b${newId()}${newId()}-${newId()}_${newId()}`;

/** What the fake FCM answers for a token: a status (with FCM's error body), a body of its own, or a failed connection. */
export type FcmAnswer = number | "network" | { status: number; body: unknown };

/** FCM's error body for a status and errorCode (google.firebase.fcm.v1.FcmError). */
export const fcmErrorBody = (status: number, errorStatus: string, errorCode: string, extra: object[] = [], message = "Request failed") => ({
  error: {
    code: status,
    message,
    status: errorStatus,
    details: [{ "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError", errorCode }, ...extra],
  },
});

export type FcmDelivered = { token: string; headers: Headers; url: string; body: { message: Record<string, unknown> & { token: string } } };

/**
 * Plays Google: the OAuth token endpoint and FCM's messages:send for `account`.
 *
 * - The token endpoint checks the form (grant type, assertion) and the JWT: RS256
 *   signed by the account's key, iss = client_email, the FCM scope, aud = the
 *   token endpoint, at most an hour. A bad one gets 400 invalid_grant. A good
 *   one gets a fresh access token, valid `expiresIn` seconds.
 * - messages:send must be at the account's project, with a current access token
 *   (else 401), JSON. It's recorded and answered as `answer` set for its token
 *   (200 by default).
 *
 * `fetch` is a FetchLike to inject; `install()` puts it in place of global fetch
 * (with `others` for any other host). Any other address fails the test.
 */
export const fakeGoogle = (account: TestServiceAccount) => {
  const assertions: { header: Record<string, unknown>; claims: Record<string, unknown> }[] = [];
  const delivered: FcmDelivered[] = [];
  const answers = new Map<string, FcmAnswer>();
  const issued = new Set<string>();
  const state = { expiresIn: 3600, tokenAnswer: null as FcmAnswer | null, revoked: false };
  const sendUrl = fcmSendUrl(account.projectId);
  const invalid = (description: string) =>
    new Response(JSON.stringify({ error: "invalid_grant", error_description: description }), { status: 400 });

  const handle = async (request: Request): Promise<Response> => {
    if (request.redirect !== "manual") throw new Error("FCM requests must not follow redirects");
    if (request.url === FCM_TOKEN_URL) {
      if (state.tokenAnswer === "network") throw new TypeError("Network connection lost.");
      if (request.method !== "POST") return new Response(null, { status: 405 });
      if (request.headers.get("content-type") !== "application/x-www-form-urlencoded") return invalid("content type");
      const form = new URLSearchParams(new TextDecoder().decode(await request.arrayBuffer()));
      if (form.get("grant_type") !== "urn:ietf:params:oauth:grant-type:jwt-bearer") return invalid("grant type");
      const [header, claims, signature, extra] = (form.get("assertion") ?? "").split(".");
      if (!header || !claims || !signature || extra !== undefined) return invalid("not a JWT");
      const valid = await crypto.subtle.verify(
        "RSASSA-PKCS1-v1_5",
        account.verifyKey,
        fromBase64Url(signature) ?? new Uint8Array(),
        utf8(`${header}.${claims}`)
      );
      if (!valid) return invalid("signature");
      const decoded = {
        header: JSON.parse(new TextDecoder().decode(fromBase64Url(header)!)) as Record<string, unknown>,
        claims: JSON.parse(new TextDecoder().decode(fromBase64Url(claims)!)) as Record<string, unknown>,
      };
      const c = decoded.claims as { iss?: unknown; scope?: unknown; aud?: unknown; iat?: unknown; exp?: unknown };
      if (decoded.header.alg !== "RS256" || decoded.header.typ !== "JWT") return invalid("header");
      if (c.iss !== account.clientEmail || c.scope !== FCM_SCOPE || c.aud !== FCM_TOKEN_URL) return invalid("claims");
      if (typeof c.iat !== "number" || typeof c.exp !== "number" || c.exp <= c.iat || c.exp - c.iat > 3600) return invalid("lifetime");
      assertions.push(decoded);
      if (typeof state.tokenAnswer === "number") return new Response(JSON.stringify({ error: "x" }), { status: state.tokenAnswer });
      if (state.tokenAnswer) return new Response(JSON.stringify(state.tokenAnswer.body), { status: state.tokenAnswer.status });
      const accessToken = `ya29.test-${issued.size + 1}-${newId()}`;
      issued.add(accessToken);
      return new Response(JSON.stringify({ access_token: accessToken, expires_in: state.expiresIn, token_type: "Bearer" }), {
        headers: { "content-type": "application/json" },
      });
    }
    if (request.url === sendUrl) {
      if (request.method !== "POST") return new Response(null, { status: 405 });
      const bearer = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
      if (!bearer || !issued.has(bearer) || state.revoked) {
        return new Response(JSON.stringify(fcmErrorBody(401, "UNAUTHENTICATED", "THIRD_PARTY_AUTH_ERROR")), { status: 401 });
      }
      if (!request.headers.get("content-type")?.startsWith("application/json")) return new Response(null, { status: 415 });
      const body = (await request.json()) as FcmDelivered["body"];
      const token = body.message.token;
      const answer = answers.get(token) ?? 200;
      if (answer === "network") throw new TypeError("Network connection lost.");
      delivered.push({ token, headers: request.headers, url: request.url, body });
      if (typeof answer === "object") return new Response(JSON.stringify(answer.body), { status: answer.status });
      if (answer === 200) return Response.json({ name: `projects/${account.projectId}/messages/0:${newId()}` });
      return new Response(JSON.stringify(fcmErrorBody(answer, "INTERNAL", "INTERNAL")), { status: answer });
    }
    throw new Error("Unexpected fetch");
  };

  const fetchLike = (input: string, init: RequestInit) => handle(new Request(input, init));
  return {
    assertions,
    delivered,
    issued,
    state,
    handle,
    fetch: fetchLike,
    answer: (token: string, answer: FcmAnswer) => answers.set(token, answer),
    /** What FCM got for `token`: each message's data. */
    to: (token: string) => delivered.filter((d) => d.token === token).map((d) => d.body.message.data as Record<string, string>),
    /** Replaces global fetch: Google, then `others` for any other address. */
    install: (others?: (request: Request) => Promise<Response>) =>
      vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
        const request = new Request(input as RequestInfo, init);
        const host = new URL(request.url).hostname;
        if ((host === "oauth2.googleapis.com" || request.url.startsWith("https://fcm.googleapis.com/v1/")) || !others) return handle(request);
        return others(request);
      }),
  };
};

/** The test Worker's bindings with both channels on: VAPID and an FCM service account. */
export const fcmEnv = async (account?: TestServiceAccount): Promise<Env> => ({
  ...PUSH_ENV,
  FCM_SERVICE_ACCOUNT: (account ?? (await serviceAccount())).json,
});
