/**
 * Supporter payments (SY-60…SY-65): Checkout, the Customer Portal, and the
 * webhook that is the only source of supporter status.
 */

import { LIFETIME_PLAN, getAccount, type AccountRow, type Status } from "./accounts";
import type { Caller } from "./auth";
import { ID_PATTERN } from "./bytes";
import type { Env } from "./env";
import { HttpError, json, parseJson } from "./http";
import {
  cancelSubscriptionAtPeriodEnd,
  createCheckoutSession,
  createPortalSession,
  getCharge,
  getSubscription,
  priceForLookupKey,
  verifyWebhookSignature,
  type StripeSubscription,
} from "./stripe";

/** The plans on the Support page; ids are Stripe price lookup keys (SY-60). */
export const PLANS: Record<string, { mode: "subscription" | "payment" }> = {
  supporter_6_yearly: { mode: "subscription" },
  supporter_12_yearly: { mode: "subscription" },
  supporter_24_yearly: { mode: "subscription" },
  [LIFETIME_PLAN]: { mode: "payment" },
};

/**
 * POST /v1/checkout — body { plan }. Creates a Checkout Session whose only
 * metadata is the opaque account id and the plan id (SY-61, SY-82).
 */
export const startCheckout = async (env: Env, caller: Caller, body: Uint8Array): Promise<Response> => {
  const input = parseJson(body);
  const plan = typeof input.plan === "string" ? input.plan : "";
  const planInfo = PLANS[plan];
  if (!planInfo) throw new HttpError(400, "bad_plan");
  const account = await getAccount(env.DB, caller.accountId);
  // Already supporting: change the amount in the portal instead. A yearly
  // supporter may still buy lifetime.
  if (account?.status === "lifetime" || (planInfo.mode === "subscription" && (account?.status === "active" || account?.status === "past_due"))) {
    throw new HttpError(409, "already_supporter");
  }
  const price = await priceForLookupKey(env, plan);
  const metadata = { account_id: caller.accountId, plan };
  const session = await createCheckoutSession(env, {
    mode: planInfo.mode,
    line_items: [{ price: price.id, quantity: 1 }],
    client_reference_id: caller.accountId,
    metadata,
    customer: account?.stripe_customer_id ?? undefined,
    ...(planInfo.mode === "subscription"
      ? { subscription_data: { metadata } }
      : { customer_creation: account?.stripe_customer_id ? undefined : "always" }),
    success_url: `${env.APP_ORIGIN}/support?checkout=done`,
    cancel_url: `${env.APP_ORIGIN}/support?checkout=cancelled`,
    ...(env.MANAGED_PAYMENTS === "true" ? { managed_payments: { enabled: true } } : {}),
  });
  return json({ url: session.url });
};

/** POST /v1/portal — a Customer Portal session for this account (SY-64). */
export const openPortal = async (env: Env, caller: Caller): Promise<Response> => {
  const account = await getAccount(env.DB, caller.accountId);
  if (!account?.stripe_customer_id) throw new HttpError(402, "not_supporter");
  const session = await createPortalSession(env, account.stripe_customer_id, `${env.APP_ORIGIN}/support`);
  return json({ url: session.url });
};

/** Maps a Stripe subscription to an account status (SY-65, SY-66). */
export const statusFromSubscription = (subscription: StripeSubscription): Status | null => {
  switch (subscription.status) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
      // Stripe is retrying the card: sync keeps working meanwhile (SY-65).
      return "past_due";
    case "canceled":
    case "unpaid":
    case "paused":
    case "incomplete_expired":
      return "lapsed";
    default:
      // "incomplete": the first payment hasn't gone through; nothing to grant yet.
      return null;
  }
};

const periodEnd = (subscription: StripeSubscription) => {
  const seconds = subscription.items.data[0]?.current_period_end ?? subscription.current_period_end;
  return seconds ? seconds * 1000 : null;
};

/**
 * Upserts the account from the subscription's current state. Never downgrades a
 * lifetime supporter; keeps the first lapse date so the purge clock isn't reset.
 */
const applySubscription = async (
  env: Env,
  accountId: string,
  subscription: StripeSubscription,
  allowReactivation = false
) => {
  const status = statusFromSubscription(subscription);
  if (!status) return;
  const existing = await getAccount(env.DB, accountId);
  // A refund/dispute hold isn't undone by an unrelated subscription update.
  // A new successful invoice, a new Checkout, or a dispute won may lift it.
  if (existing?.status === "lapsed" && status !== "lapsed" && !allowReactivation) return;
  const now = Date.now();
  const endedAt = subscription.ended_at ?? subscription.canceled_at;
  const lapsedAt = status === "lapsed" ? (endedAt ? endedAt * 1000 : now) : null;
  await env.DB.prepare(
    `INSERT INTO accounts (account_id, status, plan, stripe_customer_id, stripe_subscription_id, paid_through,
       cancel_at_period_end, lapsed_at, created_at, updated_at, seq, purged_seq)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9, 0, 0)
     ON CONFLICT (account_id) DO UPDATE SET
       status = excluded.status,
       plan = excluded.plan,
       stripe_customer_id = excluded.stripe_customer_id,
       stripe_subscription_id = excluded.stripe_subscription_id,
       paid_through = excluded.paid_through,
       cancel_at_period_end = excluded.cancel_at_period_end,
       lapsed_at = CASE WHEN excluded.status = 'lapsed' THEN COALESCE(accounts.lapsed_at, excluded.lapsed_at) ELSE NULL END,
       updated_at = excluded.updated_at
     WHERE accounts.status <> 'lifetime'`
  )
    .bind(
      accountId,
      status,
      subscription.items.data[0]?.price.lookup_key ?? null,
      subscription.customer,
      subscription.id,
      periodEnd(subscription),
      subscription.cancel_at_period_end === true ? 1 : 0,
      lapsedAt,
      now
    )
    .run();
};

const applyLifetime = async (env: Env, accountId: string, customer: string | null) => {
  const existing = await getAccount(env.DB, accountId);
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO accounts (account_id, status, plan, stripe_customer_id, stripe_subscription_id, paid_through,
       lapsed_at, created_at, updated_at, seq, purged_seq)
     VALUES (?1, 'lifetime', ?2, ?3, NULL, NULL, NULL, ?4, ?4, 0, 0)
     ON CONFLICT (account_id) DO UPDATE SET
       status = 'lifetime', plan = ?2, stripe_customer_id = COALESCE(?3, accounts.stripe_customer_id),
       paid_through = NULL, cancel_at_period_end = 0, lapsed_at = NULL, updated_at = ?4`
  )
    .bind(accountId, LIFETIME_PLAN, customer, now)
    .run();
  // A yearly supporter who bought lifetime shouldn't be charged again.
  if (existing?.stripe_subscription_id && existing.status !== "lapsed") {
    await cancelSubscriptionAtPeriodEnd(env, existing.stripe_subscription_id);
  }
};

/** Finds the account a subscription belongs to: metadata first, then stored ids. */
const accountForSubscription = async (env: Env, subscription: StripeSubscription): Promise<string | null> => {
  const fromMetadata = subscription.metadata?.account_id;
  if (fromMetadata && ID_PATTERN.test(fromMetadata)) return fromMetadata;
  const row = await env.DB.prepare(
    "SELECT account_id FROM accounts WHERE stripe_subscription_id = ? OR stripe_customer_id = ? LIMIT 1"
  )
    .bind(subscription.id, subscription.customer)
    .first<Pick<AccountRow, "account_id">>();
  return row?.account_id ?? null;
};

type StripeEvent = { id: string; type: string; data: { object: Record<string, unknown> } };

const str = (value: unknown): string | null => (typeof value === "string" && value ? value : null);
/** Stripe fields that may be an id or an expanded object. */
const idOf = (value: unknown): string | null =>
  str(value) ?? (value && typeof value === "object" ? str((value as { id?: unknown }).id) : null);

/** Re-reads the subscription from Stripe, so events arriving late or twice can't leave a stale state. */
const syncSubscription = async (
  env: Env,
  subscriptionId: string,
  accountId?: string | null,
  allowReactivation = false
) => {
  const subscription = await getSubscription(env, subscriptionId);
  const owner = accountId ?? (await accountForSubscription(env, subscription));
  if (owner) await applySubscription(env, owner, subscription, allowReactivation);
};

/** Full refunds and new disputes revoke write access, never the menus themselves. */
const lapseForCustomer = async (env: Env, customerId: string) => {
  const now = Date.now();
  await env.DB.prepare(
    `UPDATE accounts SET status = 'lapsed', lapsed_at = COALESCE(lapsed_at, ?2), updated_at = ?2
     WHERE stripe_customer_id = ?1 AND status <> 'lapsed'`
  ).bind(customerId, now).run();
};

/** Finds the account from a dispute's charge, whose customer id Stripe doesn't put on the dispute. */
const accountForDispute = async (env: Env, object: Record<string, unknown>) => {
  const chargeId = idOf(object.charge);
  if (!chargeId) return null;
  const charge = await getCharge(env, chargeId);
  if (!charge.customer) return null;
  const account = await env.DB.prepare("SELECT * FROM accounts WHERE stripe_customer_id = ? LIMIT 1")
    .bind(charge.customer)
    .first<AccountRow>();
  return account ? { account, charge } : null;
};

const handleEvent = async (env: Env, event: StripeEvent) => {
  const object = event.data.object;
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const accountId = str(object.client_reference_id);
      if (!accountId || !ID_PATTERN.test(accountId)) return;
      if (object.mode === "subscription") {
        const subscriptionId = idOf(object.subscription);
        if (subscriptionId) await syncSubscription(env, subscriptionId, accountId, true);
      } else if (object.mode === "payment" && object.payment_status === "paid") {
        await applyLifetime(env, accountId, idOf(object.customer));
      }
      return;
    }
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const subscriptionId = str(object.id);
      if (subscriptionId) await syncSubscription(env, subscriptionId);
      return;
    }
    case "invoice.payment_failed":
    case "invoice.payment_succeeded": {
      // basil API: invoice.parent.subscription_details.subscription; older: invoice.subscription.
      const parent = object.parent as { subscription_details?: { subscription?: unknown } } | undefined;
      const subscriptionId = idOf(parent?.subscription_details?.subscription) ?? idOf(object.subscription);
      if (subscriptionId) await syncSubscription(env, subscriptionId, null, event.type === "invoice.payment_succeeded");
      return;
    }
    case "charge.refunded": {
      // Partial refunds don't revoke a whole plan. A full refund does, including lifetime.
      const amount = Number(object.amount);
      const refunded = Number(object.amount_refunded);
      const customer = idOf(object.customer);
      if (customer && amount > 0 && refunded >= amount) await lapseForCustomer(env, customer);
      return;
    }
    case "charge.dispute.created": {
      const found = await accountForDispute(env, object);
      if (found?.account.stripe_customer_id) await lapseForCustomer(env, found.account.stripe_customer_id);
      return;
    }
    case "charge.dispute.closed": {
      // A lost dispute leaves the hold in place. A won one restores the current
      // subscription state, or lifetime, unless the charge was also fully refunded.
      if (str(object.status) !== "won") return;
      const found = await accountForDispute(env, object);
      if (!found || found.charge.amount_refunded >= found.charge.amount) return;
      const { account } = found;
      if (account.stripe_subscription_id) await syncSubscription(env, account.stripe_subscription_id, account.account_id, true);
      else if (account.plan === LIFETIME_PLAN) await applyLifetime(env, account.account_id, account.stripe_customer_id);
      return;
    }
    default:
      return;
  }
};

/** POST /v1/stripe/webhook (SY-62). */
export const handleWebhook = async (env: Env, request: Request, rawBody: Uint8Array): Promise<Response> => {
  if (!env.STRIPE_WEBHOOK_SECRET) throw new HttpError(503, "billing_unavailable");
  if (!(await verifyWebhookSignature(env.STRIPE_WEBHOOK_SECRET, request.headers.get("stripe-signature"), rawBody))) {
    throw new HttpError(400, "bad_signature");
  }
  const event = parseJson(rawBody) as unknown as StripeEvent;
  if (typeof event.id !== "string" || typeof event.type !== "string" || !event.data?.object) {
    throw new HttpError(400, "bad_request");
  }
  const seen = await env.DB.prepare("SELECT 1 FROM stripe_events WHERE event_id = ?").bind(event.id).first();
  if (seen) return json({ received: true, duplicate: true });
  await handleEvent(env, event);
  // Recorded only after it was handled: if handling failed, Stripe's retry runs it again.
  await env.DB.prepare("INSERT OR IGNORE INTO stripe_events (event_id, received_at) VALUES (?, ?)")
    .bind(event.id, Date.now())
    .run();
  return json({ received: true });
};
