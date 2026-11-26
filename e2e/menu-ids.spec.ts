import { test, expect, Page } from "@playwright/test";
import { deflate } from "pako";

/**
 * Menus are stored by a random id (spec SY-20, SY-21, SV-5, SV-6, SY-90).
 */

const encode = (data: unknown) => Buffer.from(deflate(JSON.stringify(data))).toString("base64");

/** Every id-keyed menu in browser storage: id → { title, encoded, ... }. */
const storedMenus = (page: Page) =>
  page.evaluate(() =>
    Object.fromEntries(
      Object.keys(localStorage)
        .filter((key) => key.startsWith("menu-v2:"))
        .map((key) => [key.slice("menu-v2:".length), JSON.parse(localStorage.getItem(key)!)])
    )
  ) as Promise<Record<string, { title: string; encoded: string }>>;

const legacyKeys = (page: Page) =>
  page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("menu:")));

test("SY-21, SV-5: renaming keeps the menu in one entry under the same id", async ({ page }) => {
  await page.goto("/menu");
  await page.fill("input.menu-title", "First name");
  await page.fill("input.new-group-title", "Together");
  await page.press("input.new-group-title", "Enter");
  await expect(page.locator(".save-status")).toHaveText(/Saved/);
  const before = await storedMenus(page);
  expect(Object.values(before).map((m) => m.title)).toEqual(["First name"]);
  const [id] = Object.keys(before);

  await page.fill("input.menu-title", "Second name");
  await expect(page.locator(".save-status")).toHaveText(/Saved/);
  const after = await storedMenus(page);
  expect(Object.keys(after)).toEqual([id]);
  expect(after[id!]!.title).toBe("Second name");

  // SY-20: the id never appears in the link.
  expect(page.url()).not.toContain(id!);
});

test("SY-90: menus saved before ids existed are listed, and stored by id from then on", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(
    ({ a, b }) => {
      localStorage.setItem("menu:Old one", JSON.stringify({ title: "Old one", encoded: a, savedAt: 1 }));
      localStorage.setItem("menu:Oldest", b); // the oldest format: the encoded menu itself
    },
    { a: encode({ G: [{ item: "Walks" }] }), b: encode({ H: [{ item: "Tea" }] }) }
  );
  await page.goto("/library");
  await expect(page.locator(".menu-tile")).toHaveCount(2);
  // Order follows the Library's sort; compare as a set.
  expect((await page.locator(".menu-tile h2").allInnerTexts()).sort()).toEqual(["Old one", "Oldest"]);
  expect(await legacyKeys(page)).toEqual([]);
  expect(Object.values(await storedMenus(page)).map((m) => m.title).sort()).toEqual(["Old one", "Oldest"]);
});

test("SY-21: two menus with the same title open and save separately", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(
    ({ a, b }) => {
      // As sync can leave them: same title, different menus, different ids.
      localStorage.setItem("menu-v2:AAAAAAAAAAAAAAAAAAAAAA", JSON.stringify({ title: "Twins", encoded: a, savedAt: 2 }));
      localStorage.setItem("menu-v2:BBBBBBBBBBBBBBBBBBBBBB", JSON.stringify({ title: "Twins", encoded: b, savedAt: 1 }));
    },
    { a: encode({ G: [{ item: "Apples" }] }), b: encode({ G: [{ item: "Bananas" }] }) }
  );
  await page.goto("/library");
  await expect(page.locator(".menu-tile")).toHaveCount(2);

  // Open the Bananas one from its tile (whichever it is), and answer an item.
  for (const index of [0, 1]) {
    await page.goto("/library");
    await page.locator(".menu-tile").nth(index).getByRole("link").first().click();
    const group = page.locator(".menu-group").first();
    await expect(group).toContainText(/Apples|Bananas/);
    if ((await group.textContent())?.includes("Bananas")) {
      await page.locator(".menu-item select").first().selectOption("must-have");
      // Not blocked by the other menu's identical title (SV-7 only stops renames into a taken title).
      await expect(page.locator(".save-status")).not.toHaveText(/title/i);
      await expect
        .poll(async () => (await storedMenus(page)).BBBBBBBBBBBBBBBBBBBBBB?.encoded)
        .not.toBe(encode({ G: [{ item: "Bananas" }] }));
      break;
    }
  }
  const menus = await storedMenus(page);
  expect(Object.keys(menus).sort()).toEqual(["AAAAAAAAAAAAAAAAAAAAAA", "BBBBBBBBBBBBBBBBBBBBBB"]);
  // The Apples menu is untouched; the Bananas menu has the answer.
  expect(menus.AAAAAAAAAAAAAAAAAAAAAA!.encoded).toBe(encode({ G: [{ item: "Apples" }] }));
  expect(menus.BBBBBBBBBBBBBBBBBBBBBB!.encoded).not.toBe(encode({ G: [{ item: "Bananas" }] }));
});
