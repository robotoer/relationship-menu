import { test, expect, Page, Route } from "@playwright/test";
import { deflate } from "pako";

const encode = (data: unknown) => Buffer.from(deflate(JSON.stringify(data))).toString("base64");
const menuPath = (title: string, menu: object) =>
  `/menu?encoded=${encodeURIComponent(`${encode(title)}:${encode(menu)}`)}`;

/** Analytics events sent since this page load (index.html queues gtag calls in dataLayer). */
const events = (page: Page) =>
  page.evaluate(() =>
    ((window as unknown as { dataLayer?: IArguments[] }).dataLayer ?? [])
      .map((args) => Array.from(args))
      .filter((args) => args[0] === "event")
      .map((args) => ({ name: args[1] as string, params: args[2] as Record<string, unknown> }))
  );

/** Where the Support page keeps the chosen plan while the visitor is at Stripe (src/pages/Support.tsx). */
const CHECKOUT_PLAN_KEY = "support:checkout-plan";

/** A stand-in Stripe Checkout page. Real Stripe test mode is Phase 4. */
const STRIPE_CHECKOUT = "https://checkout.stripe.com/c/pay/cs_test_e2e";

/** `GET /v1/account` as the server answers it (server/README.md). */
const account = (status: "none" | "active") => ({
  status,
  plan: status === "none" ? null : "supporter_12_yearly",
  renewsAt: status === "none" ? null : Date.UTC(2027, 10, 25, 12),
  readOnly: status === "none",
  lapsedAt: null,
  purgeAt: null,
  purgeSoon: false,
  limits: { menus: 500, menuBytes: 65536, totalBytes: 4194304 },
  usage: { menus: 0, bytes: 0 },
});

type SentEvent = { name: string; params: Record<string, unknown> };

/**
 * Every analytics event from here on, across page loads: a page that's leaving for
 * Stripe can't be read with `events()` any more.
 */
const recordEvents = async (page: Page) => {
  const recorded: SentEvent[] = [];
  await page.exposeBinding("__e2eEvent", (_, name: string, params: Record<string, unknown>) => {
    recorded.push({ name, params });
  });
  await page.addInitScript(() => {
    const dataLayer: unknown[] = [];
    dataLayer.push = function (...items: unknown[]) {
      for (const item of items) {
        const args = Array.from(item as ArrayLike<unknown>);
        if (args[0] === "event") (window as unknown as { __e2eEvent: (...a: unknown[]) => void }).__e2eEvent(args[1], args[2]);
      }
      return Array.prototype.push.apply(this, items);
    };
    (window as unknown as { dataLayer: unknown[] }).dataLayer = dataLayer;
  });
  return recorded;
};

/**
 * Stubs the sync server (every `/v1/` path, on any host) and Stripe. The account
 * says `none` until `paid()`. Returns the checkout requests' bodies.
 */
const stubServer = async (page: Page) => {
  let status: "none" | "active" = "none";
  const checkouts: unknown[] = [];

  await page.route(/\/v1\//, async (route: Route) => {
    const { pathname } = new URL(route.request().url());
    const reply = (body: unknown, code = 200) =>
      route.fulfill({ status: code, contentType: "application/json", body: JSON.stringify(body) });
    if (pathname === "/v1/account") return reply(account(status));
    if (pathname === "/v1/checkout") {
      checkouts.push(route.request().postDataJSON());
      return reply({ url: STRIPE_CHECKOUT });
    }
    if (pathname.startsWith("/v1/menus") && route.request().method() === "GET") {
      return reply({ menus: [], next: 0, more: false });
    }
    return reply({ error: "not_supporter" }, 402);
  });
  await page.route("https://checkout.stripe.com/**", (route) =>
    route.fulfill({ contentType: "text/html", body: "<title>Stripe Checkout (stub)</title><p>Stub</p>" })
  );
  return { checkouts, paid: () => (status = "active") };
};

test.describe("Support the project", () => {
  test("SY-61: the navbar leads to the Support page, which says before checkout that it turns on sync", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await page.getByRole("link", { name: "Support", exact: true }).click();
    await expect(page).toHaveURL(/\/support$/);
    await expect(page.getByRole("heading", { level: 1, name: "Support Wants & Won'ts" })).toBeVisible();

    await expect(page.getByRole("group", { name: "Pay what you like" })).toHaveAccessibleDescription(
      /turns on sync in this browser and creates your sync code, which you'll see after paying/
    );
    for (const label of [/\$6 \/ year/, /\$12 \/ year/, /\$24 \/ year/, /\$30 once/]) {
      await expect(page.getByRole("button", { name: label })).toBeEnabled();
    }
    // SY-71: no account here, so no heart.
    await expect(page.getByRole("link", { name: "Supporter" })).toHaveCount(0);

    expect(await events(page)).toEqual(expect.arrayContaining([{ name: "support_viewed", params: { from: "nav" } }]));
  });

  test("SY-61, SY-69, SY-71, SY-75: choosing an amount opens Stripe Checkout, and coming back waits for the server", async ({
    page,
  }) => {
    const server = await stubServer(page);
    const recorded = await recordEvents(page);
    await page.goto("/support");
    await page.getByRole("button", { name: /\$12 \/ year/ }).click();

    // Sync was off, so the runtime turned it on with a new code first, as the page
    // said it would; checkout_started is recorded before leaving.
    await expect(page).toHaveURL(STRIPE_CHECKOUT);
    expect(recorded).toEqual(
      expect.arrayContaining([
        { name: "sync_enabled", params: { how: "new" } },
        { name: "checkout_started", params: { amount_usd: 12, plan: "yearly" } },
      ])
    );
    expect(server.checkouts).toEqual([{ plan: "supporter_12_yearly" }]);

    // Back from Stripe; the webhook hasn't landed for the first ask.
    await page.goto("/support?checkout=done");
    await expect(page.getByRole("status").first()).toContainText("Waiting for Stripe to confirm…");
    await expect(page).toHaveURL(/\/support$/);
    server.paid();
    await expect(page.getByRole("status").first()).toContainText("Thank you, you're a supporter!", {
      timeout: 15_000,
    });
    await expect(page.getByRole("link", { name: "Show my sync code" })).toHaveAttribute("href", "/sync");
    await expect(page.getByRole("button", { name: "Manage subscription" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Supporter" })).toHaveAttribute("href", "/sync");

    expect(recorded.filter((e) => e.name === "checkout_completed")).toEqual([
      { name: "checkout_completed", params: { amount_usd: 12, plan: "yearly" } },
    ]);
    // SY-75: the checkout events carry the amount and plan, and nothing else.
    for (const event of recorded.filter((e) => e.name.startsWith("checkout_"))) {
      expect(Object.keys(event.params).sort()).toEqual(["amount_usd", "plan"]);
    }
    expect(JSON.stringify(recorded.filter((e) => e.name.startsWith("checkout_")))).not.toMatch(/stripe|https?:|cs_test/i);
  });

  test("SY-61: coming back from a cancelled Checkout says so calmly, records it and cleans the address", async ({
    page,
  }) => {
    await page.goto("/support");
    await page.evaluate(([key]) => sessionStorage.setItem(key, "supporter_30_lifetime"), [CHECKOUT_PLAN_KEY]);
    await page.goto("/support?checkout=cancelled");

    const notice = page.getByRole("status");
    await expect(notice).toContainText("Checkout was cancelled, and nothing was charged.");
    await expect(notice).toBeFocused();
    await expect(page).toHaveURL(/\/support$/);
    await expect(page.getByRole("button", { name: /\$30 once/ })).toBeEnabled();
    expect(await events(page)).toEqual(
      expect.arrayContaining([{ name: "checkout_cancelled", params: { amount_usd: 30, plan: "lifetime" } }])
    );
    expect(await page.evaluate(([key]) => sessionStorage.getItem(key), [CHECKOUT_PLAN_KEY])).toBeNull();

    // A reload doesn't replay it.
    await page.reload();
    await expect(page.getByRole("status")).toHaveCount(0);
    expect((await events(page)).filter((e) => e.name === "checkout_cancelled")).toEqual([]);
  });

  test("SY-69: coming back with checkout=done in a browser without sync claims nothing", async ({ page }) => {
    await page.goto("/support?checkout=done");
    const notice = page.getByRole("status");
    await expect(notice).toContainText("Sync isn't on in this browser, so we can't check your supporter status here");
    await expect(notice).not.toContainText("Thank you");
    await expect(page).toHaveURL(/\/support$/);
    await expect(page.getByRole("link", { name: "Supporter" })).toHaveCount(0);
    expect((await events(page)).filter((e) => e.name === "checkout_completed")).toEqual([]);
  });

  test("after sharing, the share dialog mentions supporting the project", async ({ page }) => {
    await page.goto(menuPath("Ours", { G: [{ item: "Alpha", value: "maybe" }] }));
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.getByRole("button", { name: "Share", exact: true }).click();
    await expect(page.getByRole("link", { name: "Support the project" })).toHaveCount(0);
    await page.getByRole("button", { name: "Copy template link" }).click();
    await page.getByRole("link", { name: "Support the project" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Support Wants & Won'ts" })).toBeVisible();
    await expect
      .poll(() => events(page))
      .toEqual(expect.arrayContaining([{ name: "support_viewed", params: { from: "share" } }]));
  });

  test("the landing page and comparison results link to it", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: "support the project" })).toHaveAttribute("href", "/support");
    const a = `${encode("A")}:${encode({ G: [{ item: "Kissing", value: "must-have" }] })}`;
    const b = `${encode("B")}:${encode({ G: [{ item: "Kissing", value: "maybe" }] })}`;
    await page.goto(`/compare?encoded=${encodeURIComponent(a)}&encoded=${encodeURIComponent(b)}`);
    await expect(page.getByRole("link", { name: "Support Wants & Won'ts" })).toHaveAttribute("href", "/support");
  });
});
