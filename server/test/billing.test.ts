import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STRIPE_API_VERSION, clearPriceCache } from "../src/stripe";
import {
  Device,
  accountRow,
  call,
  createMenu,
  env,
  event,
  mockStripe,
  seedAccount,
  subscription,
  supporter,
  webhookRequest,
  type StripeCall,
} from "./helpers";

beforeEach(() => clearPriceCache());
afterEach(() => vi.restoreAllMocks());

const prices: Record<string, string> = {
  supporter_6_yearly: "price_6",
  supporter_12_yearly: "price_12",
  supporter_24_yearly: "price_24",
  supporter_30_lifetime: "price_30",
};

/** Stripe stubs for a checkout: price lookup by lookup key, then session creation. */
const checkoutStripe = () =>
  mockStripe({
    "GET /v1/prices": (c: StripeCall) => {
      const key = c.params.get("lookup_keys[0]") ?? "";
      return { data: [{ id: prices[key], lookup_key: key, recurring: key.endsWith("yearly") ? { interval: "year" } : null }] };
    },
    "POST /v1/checkout/sessions": () => ({ id: "cs_test_1", url: "https://checkout.stripe.com/c/pay/cs_test_1" }),
  });

describe("SY-60, SY-61: checkout", () => {
  it("creates a subscription Checkout Session carrying only the account id and plan", async () => {
    const device = await Device.create();
    const calls = checkoutStripe();
    const response = await device.fetch("POST", "/v1/checkout", { body: { plan: "supporter_12_yearly" } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ url: "https://checkout.stripe.com/c/pay/cs_test_1" });

    const [lookup, create] = calls;
    expect(lookup?.params.get("lookup_keys[0]")).toBe("supporter_12_yearly");
    expect(create?.headers.get("stripe-version")).toBe(STRIPE_API_VERSION);
    expect(create?.headers.get("authorization")).toBe("Bearer rk_test_fake");
    const params = Object.fromEntries(create!.params);
    expect(params).toEqual({
      mode: "subscription",
      "line_items[0][price]": "price_12",
      "line_items[0][quantity]": "1",
      client_reference_id: device.accountId,
      "metadata[account_id]": device.accountId,
      "metadata[plan]": "supporter_12_yearly",
      "subscription_data[metadata][account_id]": device.accountId,
      "subscription_data[metadata][plan]": "supporter_12_yearly",
      success_url: `${env.APP_ORIGIN}/support?checkout=done`,
      cancel_url: `${env.APP_ORIGIN}/support?checkout=cancelled`,
      "managed_payments[enabled]": "true",
    });
  });

  it("sells lifetime as a one-time payment that creates a Stripe customer", async () => {
    const device = await Device.create();
    const calls = checkoutStripe();
    await device.fetch("POST", "/v1/checkout", { body: { plan: "supporter_30_lifetime" } });
    const params = Object.fromEntries(calls[1]!.params);
    expect(params).toMatchObject({ mode: "payment", "line_items[0][price]": "price_30", customer_creation: "always" });
    expect(params).not.toHaveProperty("subscription_data[metadata][account_id]");
  });

  it("refuses unknown plans", async () => {
    const device = await Device.create();
    checkoutStripe();
    expect((await device.fetch("POST", "/v1/checkout", { body: { plan: "supporter_1000_yearly" } })).status).toBe(400);
  });

  it("sends existing supporters to the portal instead, but lets a yearly supporter buy lifetime", async () => {
    const yearly = await supporter("active");
    checkoutStripe();
    const again = await yearly.fetch("POST", "/v1/checkout", { body: { plan: "supporter_24_yearly" } });
    expect(again.status).toBe(409);
    expect((await yearly.fetch("POST", "/v1/checkout", { body: { plan: "supporter_30_lifetime" } })).status).toBe(200);

    const lifetime = await supporter("lifetime");
    expect((await lifetime.fetch("POST", "/v1/checkout", { body: { plan: "supporter_30_lifetime" } })).status).toBe(409);
  });

  it("lets a lapsed supporter support again, reusing their Stripe customer", async () => {
    const device = await Device.create();
    await seedAccount(device.accountId, "lapsed", { stripe_customer_id: "cus_back" });
    const calls = checkoutStripe();
    expect((await device.fetch("POST", "/v1/checkout", { body: { plan: "supporter_6_yearly" } })).status).toBe(200);
    expect(calls[1]?.params.get("customer")).toBe("cus_back");
  });
});

describe("SY-64: Customer Portal", () => {
  it("opens a portal session for the account's Stripe customer", async () => {
    const device = await Device.create();
    await seedAccount(device.accountId, "active", { stripe_customer_id: "cus_portal" });
    const calls = mockStripe({ "POST /v1/billing_portal/sessions": () => ({ url: "https://billing.stripe.com/p/session/x" }) });
    const response = await device.fetch("POST", "/v1/portal");
    expect(await response.json()).toEqual({ url: "https://billing.stripe.com/p/session/x" });
    expect(Object.fromEntries(calls[0]!.params)).toEqual({ customer: "cus_portal", return_url: `${env.APP_ORIGIN}/support` });
  });

  it("answers 402 without a Stripe customer", async () => {
    const device = await Device.create();
    mockStripe({});
    expect((await device.fetch("POST", "/v1/portal")).status).toBe(402);
  });
});

describe("SY-62: webhooks", () => {
  it("rejects a bad signature, a wrong secret, and a stale timestamp", async () => {
    const valid = await webhookRequest(event("customer.subscription.updated", subscription()));
    const tampered = new Request(valid, { body: (await valid.text()).replace("active", "canceled") });
    expect((await call(tampered)).status).toBe(400);

    const wrongSecret = await webhookRequest(event("customer.subscription.updated", subscription()), { secret: "whsec_other" });
    expect((await call(wrongSecret)).status).toBe(400);

    const stale = await webhookRequest(event("customer.subscription.updated", subscription()), {
      ts: Math.floor(Date.now() / 1000) - 301,
    });
    expect((await call(stale)).status).toBe(400);

    const unsigned = new Request("https://sync.test/v1/stripe/webhook", { method: "POST", body: "{}" });
    expect((await call(unsigned)).status).toBe(400);
  });

  it("checkout.session.completed (subscription) makes the account an active supporter", async () => {
    const device = await Device.create();
    const periodEnd = Math.floor(Date.now() / 1000) + 365 * 24 * 3600;
    mockStripe({
      "GET /v1/subscriptions/sub_new": () =>
        subscription({ id: "sub_new", customer: "cus_new", account_id: device.accountId, lookup_key: "supporter_6_yearly", period_end: periodEnd }),
    });
    const response = await call(
      await webhookRequest(
        event("checkout.session.completed", {
          id: "cs_1",
          object: "checkout.session",
          mode: "subscription",
          client_reference_id: device.accountId,
          customer: "cus_new",
          subscription: "sub_new",
          payment_status: "paid",
        })
      )
    );
    expect(response.status).toBe(200);
    expect(await accountRow(device.accountId)).toMatchObject({
      status: "active",
      plan: "supporter_6_yearly",
      stripe_customer_id: "cus_new",
      stripe_subscription_id: "sub_new",
      paid_through: periodEnd * 1000,
      lapsed_at: null,
    });
    // The device can now sync.
    expect((await device.fetch("GET", "/v1/menus?since=0")).status).toBe(200);
  });

  it("SY-64: keeps Stripe's cancel-at-period-end flag for the renewal wording", async () => {
    const device = await Device.create();
    await seedAccount(device.accountId, "active", { stripe_subscription_id: "sub_cancel", stripe_customer_id: "cus_cancel" });
    mockStripe({
      "GET /v1/subscriptions/sub_cancel": () =>
        subscription({ id: "sub_cancel", customer: "cus_cancel", account_id: device.accountId, cancel_at_period_end: true }),
    });
    await call(await webhookRequest(event("customer.subscription.updated", subscription({ id: "sub_cancel" }))));
    expect(await accountRow(device.accountId)).toMatchObject({ status: "active", cancel_at_period_end: 1 });
    expect(await (await device.fetch("GET", "/v1/account")).json()).toMatchObject({ cancelAtPeriodEnd: true });
  });

  it("checkout.session.completed (payment) makes a lifetime supporter, and stops any yearly renewal", async () => {
    const device = await Device.create();
    await seedAccount(device.accountId, "active", { stripe_subscription_id: "sub_yearly", stripe_customer_id: "cus_l" });
    const calls = mockStripe({ "POST /v1/subscriptions/sub_yearly": () => subscription({ id: "sub_yearly" }) });
    await call(
      await webhookRequest(
        event("checkout.session.completed", {
          object: "checkout.session",
          mode: "payment",
          client_reference_id: device.accountId,
          customer: "cus_l",
          payment_status: "paid",
        })
      )
    );
    expect(await accountRow(device.accountId)).toMatchObject({ status: "lifetime", plan: "supporter_30_lifetime", paid_through: null });
    expect(calls[0]?.params.get("cancel_at_period_end")).toBe("true");
  });

  it("an unpaid one-time checkout grants nothing yet; async_payment_succeeded does", async () => {
    const device = await Device.create();
    mockStripe({});
    const session = { object: "checkout.session", mode: "payment", client_reference_id: device.accountId, customer: "cus_a" };
    await call(await webhookRequest(event("checkout.session.completed", { ...session, payment_status: "unpaid" })));
    expect(await accountRow(device.accountId)).toBeNull();
    await call(await webhookRequest(event("checkout.session.async_payment_succeeded", { ...session, payment_status: "paid" })));
    expect(await accountRow(device.accountId)).toMatchObject({ status: "lifetime" });
  });

  it("SY-65: invoice.payment_failed → past_due, and sync keeps working", async () => {
    const device = await Device.create();
    await seedAccount(device.accountId, "active", { stripe_subscription_id: "sub_pf", stripe_customer_id: "cus_pf" });
    mockStripe({ "GET /v1/subscriptions/sub_pf": () => subscription({ id: "sub_pf", status: "past_due", customer: "cus_pf" }) });
    await call(
      await webhookRequest(
        event("invoice.payment_failed", {
          object: "invoice",
          customer: "cus_pf",
          parent: { type: "subscription_details", subscription_details: { subscription: "sub_pf" } },
        })
      )
    );
    expect(await accountRow(device.accountId)).toMatchObject({ status: "past_due" });
    const write = await device.fetch("PUT", "/v1/menus/AAAAAAAAAAAAAAAAAAAAAA", {
      body: new Uint8Array(64),
      headers: { "if-none-match": "*" },
    });
    expect(write.status).toBe(200);
  });

  it("SY-66: customer.subscription.deleted → lapsed (read-only), dated when the subscription ended", async () => {
    const device = await Device.create();
    await seedAccount(device.accountId, "active", { stripe_subscription_id: "sub_end" });
    const endedAt = Math.floor(Date.now() / 1000) - 60;
    mockStripe({
      "GET /v1/subscriptions/sub_end": () =>
        subscription({ id: "sub_end", status: "canceled", account_id: device.accountId, ended_at: endedAt }),
    });
    await call(await webhookRequest(event("customer.subscription.deleted", subscription({ id: "sub_end", status: "canceled" }))));
    expect(await accountRow(device.accountId)).toMatchObject({ status: "lapsed", lapsed_at: endedAt * 1000 });
  });

  it("re-reads the subscription, so a stale event arriving late can't undo a cancellation", async () => {
    const device = await Device.create();
    await seedAccount(device.accountId, "lapsed", { stripe_subscription_id: "sub_late", lapsed_at: 1000 });
    mockStripe({
      "GET /v1/subscriptions/sub_late": () => subscription({ id: "sub_late", status: "canceled", account_id: device.accountId }),
    });
    // The event body still says "active" (it was sent before the cancellation).
    await call(await webhookRequest(event("customer.subscription.updated", subscription({ id: "sub_late", status: "active" }))));
    // Still lapsed, and the purge clock wasn't reset.
    expect(await accountRow(device.accountId)).toMatchObject({ status: "lapsed", lapsed_at: 1000 });
  });

  it("SY-62: a full refund makes even lifetime read-only; a partial refund doesn't", async () => {
    const device = await Device.create();
    await seedAccount(device.accountId, "lifetime", { stripe_customer_id: "cus_refund" });
    await createMenu(device);
    mockStripe({});
    const charge = { object: "charge", id: "ch_refund", customer: "cus_refund", amount: 3000 };
    await call(await webhookRequest(event("charge.refunded", { ...charge, amount_refunded: 500 })));
    expect(await accountRow(device.accountId)).toMatchObject({ status: "lifetime" });
    await call(await webhookRequest(event("charge.refunded", { ...charge, amount_refunded: 3000 })));
    expect(await accountRow(device.accountId)).toMatchObject({ status: "lapsed" });
    expect((await device.fetch("GET", "/v1/menus?since=0")).status).toBe(200);
    const write = await device.fetch("PUT", "/v1/menus/AAAAAAAAAAAAAAAAAAAAAA", {
      body: new Uint8Array(64),
      headers: { "if-none-match": "*" },
    });
    expect(write.status).toBe(402);
  });

  it("SY-62: a dispute hold isn't lifted by an unrelated update, only by a successful invoice", async () => {
    const device = await Device.create();
    await seedAccount(device.accountId, "active", { stripe_customer_id: "cus_dispute", stripe_subscription_id: "sub_dispute" });
    mockStripe({
      "GET /v1/charges/ch_dispute": () => ({ id: "ch_dispute", customer: "cus_dispute", amount: 600, amount_refunded: 0 }),
      "GET /v1/subscriptions/sub_dispute": () =>
        subscription({ id: "sub_dispute", status: "active", customer: "cus_dispute", account_id: device.accountId }),
    });
    const dispute = { object: "dispute", id: "dp_dispute", charge: "ch_dispute", status: "needs_response" };
    await call(await webhookRequest(event("charge.dispute.created", dispute)));
    expect(await accountRow(device.accountId)).toMatchObject({ status: "lapsed" });

    await call(await webhookRequest(event("customer.subscription.updated", subscription({ id: "sub_dispute", status: "active" }))));
    expect(await accountRow(device.accountId)).toMatchObject({ status: "lapsed" });

    await call(
      await webhookRequest(
        event("invoice.payment_succeeded", {
          object: "invoice",
          parent: { type: "subscription_details", subscription_details: { subscription: "sub_dispute" } },
        })
      )
    );
    expect(await accountRow(device.accountId)).toMatchObject({ status: "active" });
  });

  it("SY-62: winning a lifetime dispute restores supporter status", async () => {
    const device = await Device.create();
    await seedAccount(device.accountId, "lifetime", { stripe_customer_id: "cus_won" });
    mockStripe({
      "GET /v1/charges/ch_won": () => ({ id: "ch_won", customer: "cus_won", amount: 3000, amount_refunded: 0 }),
    });
    await call(await webhookRequest(event("charge.dispute.created", { object: "dispute", charge: "ch_won", status: "needs_response" })));
    expect(await accountRow(device.accountId)).toMatchObject({ status: "lapsed" });
    await call(await webhookRequest(event("charge.dispute.closed", { object: "dispute", charge: "ch_won", status: "won" })));
    expect(await accountRow(device.accountId)).toMatchObject({ status: "lifetime" });
  });

  it("handles each event id once", async () => {
    const device = await Device.create();
    await seedAccount(device.accountId, "active", { stripe_subscription_id: "sub_dup" });
    const calls = mockStripe({ "GET /v1/subscriptions/sub_dup": () => subscription({ id: "sub_dup", account_id: device.accountId }) });
    const evt = event("customer.subscription.updated", subscription({ id: "sub_dup" }), "evt_dup_1");
    expect((await call(await webhookRequest(evt))).status).toBe(200);
    const second = await call(await webhookRequest(evt));
    expect(await second.json()).toEqual({ received: true, duplicate: true });
    expect(calls).toHaveLength(1);
  });

  it("never downgrades a lifetime supporter from an old subscription's events", async () => {
    const device = await Device.create();
    await seedAccount(device.accountId, "lifetime", { stripe_subscription_id: "sub_old" });
    mockStripe({ "GET /v1/subscriptions/sub_old": () => subscription({ id: "sub_old", status: "canceled", account_id: device.accountId }) });
    await call(await webhookRequest(event("customer.subscription.deleted", subscription({ id: "sub_old" }))));
    expect(await accountRow(device.accountId)).toMatchObject({ status: "lifetime" });
  });

  it("if handling fails, the event isn't recorded, so Stripe's retry runs it again", async () => {
    const device = await Device.create();
    await seedAccount(device.accountId, "active", { stripe_subscription_id: "sub_retry" });
    mockStripe({}); // Stripe API unavailable: the re-read fails.
    const evt = event("customer.subscription.updated", subscription({ id: "sub_retry" }), "evt_retry_1");
    expect((await call(await webhookRequest(evt))).status).toBe(502);
    vi.restoreAllMocks();
    mockStripe({
      "GET /v1/subscriptions/sub_retry": () => subscription({ id: "sub_retry", status: "past_due", account_id: device.accountId }),
    });
    expect((await call(await webhookRequest(evt))).status).toBe(200);
    expect(await accountRow(device.accountId)).toMatchObject({ status: "past_due" });
  });

  it("acknowledges event types it doesn't handle", async () => {
    mockStripe({});
    const response = await call(await webhookRequest(event("customer.created", { id: "cus_x", object: "customer" })));
    expect(response.status).toBe(200);
  });
});

describe("SY-63: the server stores no personal details", () => {
  it("has no columns for email, name, card or address", async () => {
    const { results } = await env.DB.prepare("PRAGMA table_info(accounts)").all<{ name: string }>();
    expect(results.map((c) => c.name).sort()).toEqual(
      [
        "account_id",
        "created_at",
        "lapsed_at",
        "paid_through",
        "cancel_at_period_end",
        "plan",
        "purged_seq",
        "seq",
        "status",
        "stripe_customer_id",
        "stripe_subscription_id",
        "updated_at",
      ].sort()
    );
  });
});
