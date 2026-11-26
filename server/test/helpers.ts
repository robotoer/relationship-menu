/**
 * Test helpers. `Device` signs requests exactly as the app will (SY-6), so these
 * tests double as the reference for the client's implementation.
 */

import { env } from "cloudflare:workers";
import { vi } from "vitest";
import { PROTOCOL, canonicalRequest } from "../src/auth";
import { concat, sha256, toBase64Url, toHex, utf8 } from "../src/bytes";
import { handleRequest } from "../src/index";

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
    options: { body?: Uint8Array | string | object; headers?: Record<string, string>; ts?: number } = {}
  ): Promise<Response> {
    const body = toBody(options.body);
    const headers = new Headers(options.headers);
    headers.set("authorization", await this.authorization(method, pathAndQuery, body, options.ts));
    return call(new Request(`https://sync.test${pathAndQuery}`, { method, headers, body: body.length ? body : undefined }));
  }
}

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
  over: Partial<{ id: string; status: string; customer: string; account_id: string; lookup_key: string; period_end: number; canceled_at: number; ended_at: number }> = {}
) => ({
  id: over.id ?? "sub_test_1",
  object: "subscription",
  status: over.status ?? "active",
  customer: over.customer ?? "cus_test_1",
  metadata: over.account_id ? { account_id: over.account_id, plan: over.lookup_key ?? "supporter_12_yearly" } : {},
  canceled_at: over.canceled_at ?? null,
  ended_at: over.ended_at ?? null,
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
