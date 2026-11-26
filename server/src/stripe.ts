/**
 * A minimal Stripe client over fetch (no SDK): the handful of calls this Worker
 * needs, and webhook signature verification.
 */

import { concat, timingSafeEqual, toHex, utf8 } from "./bytes";
import type { Env } from "./env";
import { HttpError } from "./http";

const API = "https://api.stripe.com";
/** Managed Payments needs 2025-03-31.basil or later. Webhook endpoints use the same version. */
export const STRIPE_API_VERSION = "2025-03-31.basil";

type FormValue = string | number | boolean | undefined | null;
type Form = { [key: string]: FormValue | Form | Form[] };

/** Encodes nested objects the way Stripe expects: a[b][0][c]=d. */
export const encodeForm = (form: Form, prefix = ""): string[] => {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(form)) {
    const name = prefix ? `${prefix}[${key}]` : key;
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      value.forEach((item, i) => parts.push(...encodeForm(item, `${name}[${i}]`)));
    } else if (typeof value === "object") {
      parts.push(...encodeForm(value, name));
    } else {
      parts.push(`${encodeURIComponent(name)}=${encodeURIComponent(String(value))}`);
    }
  }
  return parts;
};

const stripe = async <T>(env: Env, method: "GET" | "POST" | "DELETE", path: string, form?: Form): Promise<T> => {
  if (!env.STRIPE_SECRET_KEY) throw new HttpError(503, "billing_unavailable");
  const body = form ? encodeForm(form).join("&") : undefined;
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "stripe-version": STRIPE_API_VERSION,
      ...(body ? { "content-type": "application/x-www-form-urlencoded" } : {}),
    },
    body,
  });
  if (!response.ok) {
    // Stripe's error body can echo request data; never log or return it.
    throw new HttpError(502, "billing_error", { stripeStatus: response.status });
  }
  return (await response.json()) as T;
};

export type StripePrice = { id: string; lookup_key: string | null; recurring: { interval: string } | null };
export type StripeSubscription = {
  id: string;
  status: string;
  customer: string;
  metadata: Record<string, string>;
  canceled_at?: number | null;
  ended_at?: number | null;
  current_period_end?: number;
  items: { data: { current_period_end?: number; price: { id: string; lookup_key: string | null } }[] };
};

/** Prices by lookup key, cached per isolate for 10 minutes (SY-60). */
const priceCache = new Map<string, { price: StripePrice; at: number }>();
export const clearPriceCache = () => priceCache.clear();

export const priceForLookupKey = async (env: Env, lookupKey: string): Promise<StripePrice> => {
  const cached = priceCache.get(lookupKey);
  if (cached && Date.now() - cached.at < 10 * 60 * 1000) return cached.price;
  const query = `lookup_keys[0]=${encodeURIComponent(lookupKey)}&active=true&limit=1`;
  const list = await stripe<{ data: StripePrice[] }>(env, "GET", `/v1/prices?${query}`);
  const price = list.data[0];
  if (!price) throw new HttpError(503, "billing_unavailable");
  priceCache.set(lookupKey, { price, at: Date.now() });
  return price;
};

export const createCheckoutSession = (env: Env, form: Form) =>
  stripe<{ id: string; url: string }>(env, "POST", "/v1/checkout/sessions", form);

export const createPortalSession = (env: Env, customer: string, returnUrl: string) =>
  stripe<{ url: string }>(env, "POST", "/v1/billing_portal/sessions", { customer, return_url: returnUrl });

export const getSubscription = (env: Env, id: string) =>
  stripe<StripeSubscription>(env, "GET", `/v1/subscriptions/${encodeURIComponent(id)}`);

/** Cancels at once (no more charges). Used when someone deletes everything (SY-68). */
export const cancelSubscription = (env: Env, id: string) =>
  stripe<StripeSubscription>(env, "DELETE", `/v1/subscriptions/${encodeURIComponent(id)}`);

/** Stops renewal; used when a yearly supporter buys lifetime. */
export const cancelSubscriptionAtPeriodEnd = (env: Env, id: string) =>
  stripe<StripeSubscription>(env, "POST", `/v1/subscriptions/${encodeURIComponent(id)}`, {
    cancel_at_period_end: true,
  });

/** Points the subscription's metadata at a replaced sync code's new account (SY-8). */
export const updateSubscriptionAccount = (env: Env, id: string, accountId: string) =>
  stripe<StripeSubscription>(env, "POST", `/v1/subscriptions/${encodeURIComponent(id)}`, {
    metadata: { account_id: accountId },
  });

const hmacSha256Hex = async (secret: string, data: Uint8Array) => {
  const key = await crypto.subtle.importKey("raw", utf8(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(new Uint8Array(await crypto.subtle.sign("HMAC", key, data)));
};

export const WEBHOOK_TOLERANCE_SECONDS = 300;

/**
 * Verifies `Stripe-Signature: t=…,v1=…` over `${t}.${rawBody}` with HMAC-SHA-256,
 * a 5-minute tolerance and a constant-time comparison (SY-62).
 */
export const verifyWebhookSignature = async (
  secret: string,
  header: string | null,
  rawBody: Uint8Array,
  nowMs = Date.now()
): Promise<boolean> => {
  if (!header) return false;
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const [key, value] = part.split("=", 2).map((s) => s.trim());
    if (key === "t" && value && /^\d+$/.test(value)) timestamp = Number(value);
    if (key === "v1" && value) signatures.push(value);
  }
  if (timestamp === null || signatures.length === 0) return false;
  if (Math.abs(nowMs / 1000 - timestamp) > WEBHOOK_TOLERANCE_SECONDS) return false;
  const expected = await hmacSha256Hex(secret, concat(utf8(`${timestamp}.`), rawBody));
  return signatures.some((signature) => timingSafeEqual(signature, expected));
};
