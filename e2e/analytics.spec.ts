import { test, expect, Page } from "@playwright/test";
import { deflate } from "pako";

// Build links the same way the app does (pako + base64).
const encode = (data: unknown) => Buffer.from(deflate(JSON.stringify(data))).toString("base64");
const slug = (title: string, menu: object, person?: object) =>
  [encode(title), encode(menu), ...(person ? [encode(person)] : [])].join(":");

// Recognisable text that must never reach analytics (spec PR-2).
const SECRET = "Zqx";
const MENU = {
  [`${SECRET} group`]: [
    { item: `${SECRET} kissing`, value: "must-have", note: `${SECRET} note` },
    { item: `${SECRET} cuddling` },
    { item: `${SECRET} dancing` },
    { item: `${SECRET} hiking` },
  ],
};
const PERSON = { name: `${SECRET} Ana` };

/** Every gtag call so far (index.html queues them in window.dataLayer). */
const gtagCalls = (page: Page) =>
  page.evaluate(() =>
    ((window as unknown as { dataLayer?: IArguments[] }).dataLayer ?? []).map((args) =>
      JSON.stringify(Array.from(args))
    )
  );

test.describe("Analytics (PR-2)", () => {
  test("tracks what people do, and never sends menu text, names, notes or links", async ({ page }) => {
    // window.dataLayer starts empty on every full page load: collect before leaving.
    const calls: string[] = [];
    const collect = async () => calls.push(...(await gtagCalls(page)));
    // Only production reports: nothing may reach Google from a test run (or localhost).
    const googleRequests: string[] = [];
    page.on("request", (request) => {
      const host = new URL(request.url()).hostname;
      if (/(^|\.)(googletagmanager\.com|google-analytics\.com|analytics\.google\.com|doubleclick\.net)$/.test(host)) {
        googleRequests.push(host);
      }
    });
    // Start from the landing page.
    await page.goto("/");
    await page.getByRole("link", { name: /Start a menu/ }).click();
    await expect(page.getByRole("heading", { name: "Pick a starting point" })).toBeVisible();
    await collect();
    // Arrive from a shared menu link.
    await page.goto(`/menu?encoded=${encodeURIComponent(slug(`${SECRET} title`, MENU, PERSON))}`);
    await expect(page.locator(".menu-item").first()).toBeVisible();

    // Answer enough to pass a milestone, open the share dialog and copy a link.
    const pickers = page.locator(".menu-item select");
    await pickers.nth(1).selectOption("maybe");
    await pickers.nth(2).selectOption("maybe");
    // Reshape it: reword an item, add one and delete it again.
    const itemInputs = page.locator(".menu-item-input");
    await itemInputs.nth(3).fill(`${SECRET} hiking far`);
    await itemInputs.last().fill(`${SECRET} new item`);
    await page.getByRole("button", { name: `Delete item: ${SECRET} new item` }).click();
    await expect(page.locator(".save-status")).toHaveText(/Saved/);
    await page.getByRole("button", { name: "Share", exact: true }).click();
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.getByRole("button", { name: "Copy template link" }).click();
    // Compare with someone else's menu from the Share dialog.
    const other = slug("Other", { [`${SECRET} group`]: [{ item: `${SECRET} kissing`, value: "off-limits" }] });
    await page.locator("#share-their-link").fill(other);
    await page.locator(".share-compare").getByRole("button", { name: "Compare" }).click();
    await expect(page.locator(".menu-item-compare").first()).toBeVisible();

    await collect();
    // Compare two menus from a compare link, and use a filter.
    await page.goto(
      `/compare?encoded=${encodeURIComponent(slug(`${SECRET} title`, MENU, PERSON))}&encoded=${encodeURIComponent(other)}`
    );
    await expect(page.locator(".menu-item-compare").first()).toBeVisible();
    await page.getByRole("group", { name: "Show items" }).getByRole("button", { name: /^Conflicts/ }).click();

    await collect();
    // Search the Library, and reopen the menu from it.
    await page.goto("/library");
    await page.getByRole("searchbox").fill(SECRET);
    await page.getByRole("link", { name: "View" }).click();
    await expect(page.locator(".menu-item").first()).toBeVisible();
    // Core Web Vitals arrive on their own once the page has painted.
    await expect
      .poll(async () => (await gtagCalls(page)).some((c) => c.includes('"web_vital"')))
      .toBe(true);
    // Uncaught errors whose messages (and a custom name) hold menu text.
    await page.evaluate((secret) => {
      setTimeout(() => {
        throw new TypeError(`${secret} message`);
      });
      const named = new Error(`${secret} message`);
      named.name = `${secret}Error`;
      setTimeout(() => {
        throw named;
      });
      void Promise.reject(new RangeError(`${secret} rejected`));
    }, SECRET);
    await expect
      .poll(async () => (await gtagCalls(page)).filter((c) => c.includes('"app_error"')).length)
      .toBeGreaterThanOrEqual(3);
    await collect();

    const sent = calls
      .map((c) => JSON.parse(c))
      .filter((c) => c[0] === "event")
      .map((c) => ({ name: c[1] as string, params: c[2] as Record<string, unknown> }));
    const names = sent.map((e) => e.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "page_view",
        "shared_link_opened",
        "menu_progress",
        "share_dialog_opened",
        "link_copied",
        "comparison_shown",
        "compare_filter_used",
        "library_searched",
        "landing_button_clicked",
        "menu_customized",
        "library_menu_opened",
        "web_vital",
        "app_error",
      ])
    );
    const paramsOf = (name: string) => sent.filter((e) => e.name === name).map((e) => e.params);
    expect(sent.find((e) => e.name === "shared_link_opened")!.params).toMatchObject({
      link_type: "menu",
      has_person: true,
      item_count: 4,
    });
    expect(sent.find((e) => e.name === "link_copied")!.params).toEqual({ link_type: "template" });
    // (The dev server's StrictMode can send it twice; production builds send it once.)
    expect(paramsOf("comparison_shown")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ menu_count: 2, source: "share_dialog" }),
        expect.objectContaining({ menu_count: 2, source: "link", conflict_count: 1 }),
      ])
    );
    expect(paramsOf("comparison_shown").map((p) => p.source)).not.toContain("button");
    expect(paramsOf("landing_button_clicked")).toEqual([{ button_id: "hero_start" }]);
    expect(paramsOf("menu_customized")).toEqual(
      expect.arrayContaining([
        { edit_kind: "item_edited" },
        { edit_kind: "item_added" },
        { edit_kind: "item_deleted" },
      ])
    );
    // Reopening from the Library isn't counted as a shared link.
    expect(paramsOf("shared_link_opened")).toHaveLength(1);
    expect(paramsOf("library_menu_opened")).toEqual([{ item_count: 4, percent_answered: 75 }]);
    for (const vital of paramsOf("web_vital")) {
      expect(Object.keys(vital).sort()).toEqual(["metric_name", "metric_value"]);
      expect(["CLS", "FCP", "INP", "LCP", "TTFB"]).toContain(vital.metric_name);
      expect(Number.isInteger(vital.metric_value)).toBe(true);
    }
    expect(paramsOf("app_error")).toEqual(
      expect.arrayContaining([
        { error_type: "TypeError", error_source: "error" },
        { error_type: "other_error", error_source: "error" },
        { error_type: "RangeError", error_source: "unhandledrejection" },
      ])
    );

    expect(googleRequests).toEqual([]);

    // After each in-app navigation, later events report the current page (origin and
    // path only) and the page before it, not the page the app was first loaded on.
    const sets = calls
      .map((c) => JSON.parse(c))
      .filter((c) => c[0] === "set")
      .map((c) => c[1] as Record<string, string>);
    expect(sets).toEqual(
      expect.arrayContaining([
        { page_location: "http://localhost:3099/menu", page_referrer: "http://localhost:3099/" },
        { page_location: "http://localhost:3099/compare", page_referrer: "http://localhost:3099/menu" },
        { page_location: "http://localhost:3099/menu", page_referrer: "http://localhost:3099/library" },
      ])
    );
    for (const set of sets) {
      for (const value of Object.values(set)) expect(value).toMatch(/^http:\/\/localhost:3099\/[a-z]*$/);
    }

    // Nothing anyone typed, and no link contents, ever leaves the browser.
    const everything = calls.join("\n");
    expect(everything).not.toContain(SECRET);
    expect(everything).not.toContain("encoded");
  });
});
