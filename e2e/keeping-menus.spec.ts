import { test, expect, devices, Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { deflate } from "pako";

/**
 * Keeping menus (spec SV-11, SV-12, SV-13): asking the browser to keep storage, the
 * Home Screen tip for iPhone/iPad Safari, and Export all menus.
 */

// Build links the same way the app does (pako + base64).
const encode = (data: unknown) => Buffer.from(deflate(JSON.stringify(data))).toString("base64");
const menuPath = (title: string, menu: object) =>
  `/menu?encoded=${encodeURIComponent(`${encode(title)}:${encode(menu)}`)}`;

/** Analytics events sent since this page load (index.html queues gtag calls in dataLayer). */
const events = (page: Page) =>
  page.evaluate(() =>
    ((window as unknown as { dataLayer?: IArguments[] }).dataLayer ?? [])
      .map((args) => Array.from(args))
      .filter((args) => args[0] === "event")
      .map((args) => args[1] as string)
  );

/** Types a title into a fresh editor and waits until it's saved. */
const saveNewMenu = async (page: Page, title: string) => {
  await page.goto("/menu");
  await page.locator("input.menu-title").fill(title);
  await expect(page.locator(".save-status")).toHaveText("Saved");
};

test.describe("SV-11: persistent storage", () => {
  test("is asked for after the first save, once per browser", async ({ page }) => {
    // Count calls to navigator.storage.persist() on each page load.
    await page.addInitScript(() => {
      const w = window as unknown as { persistCalls: number };
      w.persistCalls = 0;
      const original = navigator.storage.persist.bind(navigator.storage);
      navigator.storage.persist = () => {
        w.persistCalls++;
        return original();
      };
    });
    await page.goto("/menu");
    expect(await page.evaluate(() => (window as unknown as { persistCalls: number }).persistCalls)).toBe(0);
    await page.locator("input.menu-title").fill("Keep me");
    await expect(page.locator(".save-status")).toHaveText("Saved");
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { persistCalls: number }).persistCalls))
      .toBe(1);
    expect(await page.evaluate(() => localStorage.getItem("storage-persist-requested"))).toBe("1");

    // A later save, after a reload, doesn't ask again.
    await saveNewMenu(page, "Another");
    expect(await page.evaluate(() => (window as unknown as { persistCalls: number }).persistCalls)).toBe(0);
    // Saving went ahead as usual.
    await page.goto("/library");
    await expect(page.getByRole("heading", { level: 2 })).toHaveText(["Another", "Keep me"]);
  });
});

test.describe("SV-13: Export all menus", () => {
  test("downloads one file with a link to every menu, which brings each one back", async ({ page, browser }) => {
    await page.goto(menuPath("Ana's menu", { Fun: [{ item: "Dancing", value: "must-have" }] }));
    await expect(page.locator(".save-status")).toHaveText("Saved");
    await page.goto(menuPath("Ben's menu", { Home: [{ item: "Moving in", value: "maybe" }] }));
    await expect(page.locator(".save-status")).toHaveText("Saved");

    // Nothing may be sent anywhere while exporting.
    const offSite: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).hostname !== "localhost") offSite.push(request.url());
    });
    await page.goto("/library");
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Export all menus" }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^relationship-menus-\d{4}-\d{2}-\d{2}\.txt$/);
    await expect(page.getByText("Downloaded a file with 2 menus.")).toBeVisible();
    expect(await events(page)).toContain("menus_exported");
    expect(offSite).toEqual([]);

    const text = await readFile((await download.path())!, "utf8");
    expect(text).toContain("2 menus saved in this browser");
    expect(text).toContain("1. Ana's menu");
    expect(text).toContain("2. Ben's menu");
    // Exactly links to this site's editor (whatever port the tests run on).
    const origin = new URL(page.url()).origin;
    const links = text.split("\n").filter((line) => {
      try {
        const url = new URL(line);
        return url.origin === origin && url.pathname === "/menu" && url.searchParams.has("encoded");
      } catch {
        return false;
      }
    });
    expect(links).toHaveLength(2);

    // In a browser that has never seen these menus, a link from the file restores one.
    const fresh = await browser.newContext();
    const other = await fresh.newPage();
    await other.goto(links[1]);
    await expect(other.locator("input.menu-title")).toHaveValue("Ben's menu");
    await expect(other.locator(".menu-item-input").first()).toHaveValue("Moving in");
    await expect(other.locator(".menu-item select").first()).toHaveValue("maybe");
    await expect(other.locator(".save-status")).toHaveText("Saved");
    await other.goto("/library");
    await expect(other.getByRole("heading", { level: 2 })).toHaveText(["Ben's menu"]);
    await fresh.close();
  });
});

// Safari on an iPhone (Chromium pretending: same user agent, size and touch screen).
const { defaultBrowserType: _ignored, ...iPhone } = devices["iPhone 13"];

test.describe("SV-12: the Home Screen tip on iPhone Safari", () => {
  test.use(iPhone);

  const tip = (page: Page) => page.getByRole("complementary", { name: "Tip: keep your menus" });

  test("shows on the landing page, in an empty Library and once after a save; dismissing it is remembered", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(tip(page)).toContainText("Safari may delete menus from sites you haven't opened in a week.");
    await expect(tip(page)).toContainText("Add to Home Screen");
    expect(await events(page)).toContain("home_screen_hint_shown");

    await page.goto("/library");
    await expect(tip(page)).toBeVisible();

    // The editor shows it right after the first save, not before.
    await page.goto("/menu");
    await expect(tip(page)).toHaveCount(0);
    await page.locator("input.menu-title").fill("First");
    await expect(page.locator(".save-status")).toHaveText("Saved");
    await expect(tip(page)).toContainText("Export all menus");
    // ...and only once per browser.
    await saveNewMenu(page, "Second");
    await expect(tip(page)).toHaveCount(0);

    // A Library with menus doesn't show it; the landing page still does, until dismissed.
    await page.goto("/library");
    await expect(page.getByRole("heading", { level: 2 })).toHaveCount(2);
    await expect(tip(page)).toHaveCount(0);
    await page.goto("/");
    await tip(page).getByRole("button", { name: "Dismiss tip about the Home Screen" }).click();
    await expect(tip(page)).toHaveCount(0);
    expect(await events(page)).toContain("home_screen_hint_dismissed");
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(tip(page)).toHaveCount(0);

    // No sideways scrolling with the tip on a small phone (AX-4).
    await page.evaluate(() => localStorage.removeItem("home-screen-hint-dismissed"));
    await page.setViewportSize({ width: 320, height: 640 });
    await page.reload();
    await expect(tip(page)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  });

  test("never shows in a Home Screen app", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "standalone", { value: true });
    });
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(tip(page)).toHaveCount(0);
    await page.goto("/library");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(tip(page)).toHaveCount(0);
  });
});

test.describe("SV-12: other browsers", () => {
  test("desktop browsers never see the tip", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Tip: keep your menus" })).toHaveCount(0);
  });
});
