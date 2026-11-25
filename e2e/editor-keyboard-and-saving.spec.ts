import { test, expect, Page } from "@playwright/test";
import { deflate, inflate } from "pako";

// Build links the same way the app does (pako + base64), without the UI.
const encode = (data: unknown) =>
  Buffer.from(deflate(JSON.stringify(data))).toString("base64");
const decode = (data: string) =>
  JSON.parse(inflate(Buffer.from(data, "base64"), { to: "string" }));
const menuPath = (title: string, menu: object) =>
  `/menu?encoded=${encodeURIComponent(`${encode(title)}:${encode(menu)}`)}`;

/** Saved menus in localStorage, by title → decoded menu. */
const savedMenus = (page: Page) =>
  page
    .evaluate(() => {
      const out: Record<string, string> = {};
      for (const key of Object.keys(localStorage)) {
        if (!key.startsWith("menu:")) continue;
        const value = localStorage.getItem(key)!;
        try {
          const doc = JSON.parse(value);
          out[doc.title] = doc.encoded;
        } catch {
          out[key.slice(5)] = value;
        }
      }
      return out;
    })
    .then((raw) =>
      Object.fromEntries(Object.entries(raw).map(([t, e]) => [t, decode(e)]))
    );

const rows = (page: Page) => page.locator(".menu-page [data-row-key]");

test.describe("Landing page", () => {
  test("explains the app and opens the starter menu", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Relationship\s*Menu/);
    await expect(page.getByRole("heading", { name: "What are all these links?" })).toBeVisible();
    await page.getByRole("link", { name: /Start with the starter menu/ }).click();
    await page.waitForURL("**/menu**");
    await expect(page.locator("input.menu-title")).toHaveValue("Our relationship menu");
    await expect(page.locator("input.new-group-title").first()).toHaveValue("Communication");
  });
});

test.describe("Keyboard controls", () => {
  test("navigate, answer, reorder, delete and undo from the keyboard", async ({ page }) => {
    await page.goto(
      menuPath("Keys", {
        G: [{ item: "Alpha" }, { item: "Beta" }, { item: "Gamma" }],
      })
    );
    await expect(rows(page)).toHaveCount(6); // header, 3 items, new item, new group
    await page.locator("body").press("j"); // start navigating
    await expect(rows(page).nth(0)).toBeFocused();
    await page.keyboard.press("j");
    await page.keyboard.press("1"); // Alpha: must have
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("4"); // Beta: off limits
    await expect(page.locator(".menu-item select").nth(0)).toHaveValue("must-have");
    await expect(page.locator(".menu-item select").nth(1)).toHaveValue("off-limits");

    await page.keyboard.press("K"); // move Beta up
    const texts = () =>
      page.locator(".menu-item-input").evaluateAll((els) =>
        els.map((e) => (e as HTMLInputElement).value)
      );
    expect(await texts()).toEqual(["Beta", "Alpha", "Gamma", ""]);

    await page.keyboard.press("d");
    await page.keyboard.press("d");
    expect(await texts()).toEqual(["Alpha", "Gamma", ""]);
    await page.keyboard.press("u");
    expect(await texts()).toEqual(["Beta", "Alpha", "Gamma", ""]);

    await page.keyboard.press("?");
    await expect(page.getByRole("dialog", { name: "Keyboard controls" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("typing mode: Enter adds items one after another", async ({ page }) => {
    await page.goto("/menu");
    await page.locator("input.new-group-title").last().fill("Fun");
    const firstItem = page.locator(".menu-group").first().locator("input.menu-item-input").last();
    await firstItem.click();
    await page.keyboard.type("Dancing");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Hiking");
    const values = await page
      .locator(".menu-group")
      .first()
      .locator("input.menu-item-input")
      .evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
    expect(values).toEqual(["Dancing", "Hiking", ""]);
  });
});

test.describe("Saving", () => {
  test("a title-only edit is saved and the old title is removed", async ({ page }) => {
    await page.goto(menuPath("Before", { G: [{ item: "Alpha" }] }));
    await expect(page.locator(".save-status")).toHaveText(/Saved/);
    const title = page.locator("input.menu-title");
    await title.fill("After");
    await expect(page.locator(".save-status")).toHaveText(/Saved/);
    expect(Object.keys(await savedMenus(page))).toEqual(["After"]);
    await page.goto("/library");
    await expect(page.locator(".menu-tile")).toHaveCount(1);
    await expect(page.locator(".menu-tile")).toContainText("After");
  });

  test("opening a template of your own menu does not wipe your answers", async ({ page }) => {
    await page.goto(menuPath("Us", { G: [{ item: "Alpha", value: "must-have" }] }));
    await expect(page.locator(".save-status")).toHaveText(/Saved/);
    await page.goto(menuPath("Us", { G: [{ item: "Alpha" }] }));
    await expect(page.locator(".menu-notice")).toContainText('opened as "Us (2)"');
    await expect(page.locator("input.menu-title")).toHaveValue("Us (2)");
    await expect(page.locator(".save-status")).toHaveText(/Saved/);
    const saved = await savedMenus(page);
    expect(saved["Us"].G[0].value).toBe("must-have");
    expect(saved["Us (2)"].G[0].value).toBeUndefined();
  });

  test("Back leaves the editor after editing", async ({ page }) => {
    await page.goto("/library");
    await page.click("text=Create New Menu");
    await page.waitForURL("**/menu**");
    await page.locator("input.new-group-title").last().fill("Group");
    await page.locator("input.menu-title").fill("Back test");
    await page.goBack();
    await page.waitForURL("**/library");
  });
});
