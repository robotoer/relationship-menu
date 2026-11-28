import { test, expect, Page } from "@playwright/test";
import { deflate, inflate } from "pako";
import { getShareValues } from "./helpers";

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
        // Menus are stored by id (SY-20): menu-v2:<id> → { title, encoded, ... }.
        if (!key.startsWith("menu-v2:")) continue;
        const doc = JSON.parse(localStorage.getItem(key)!);
        out[doc.title] = doc.encoded;
      }
      return out;
    })
    .then((raw) =>
      Object.fromEntries(Object.entries(raw).map(([t, e]) => [t, decode(e)]))
    );

const rows = (page: Page) => page.locator(".menu-page [data-row-key]");

test.describe("Landing page", () => {
  test("explains the app and starts a menu from a template", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Wants\s*&\s*Won't/);
    await expect(page.getByRole("heading", { name: "What are all these links?" })).toBeVisible();
    await page.getByRole("link", { name: /Start a menu/ }).first().click();
    await page.waitForURL("**/menu**");
    await expect(page.getByRole("heading", { name: "Pick a starting point" })).toBeVisible();
    await page.getByRole("button", { name: /Close Friendship/ }).click();
    await expect(page.locator("input.menu-title")).toHaveValue("Close Friendship");
    await expect(page.locator("input.new-group-title").first()).toHaveValue("Staying in touch");
    await expect(page.locator(".save-status")).toHaveText(/Saved/);
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
    await page.keyboard.press("5"); // Beta: off limits (4 is Soft no, SV-18)
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
    const firstItem = page.locator(".menu-group").first().locator(".menu-item-input").last();
    await firstItem.click();
    await page.keyboard.type("Dancing");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Hiking");
    const values = await page
      .locator(".menu-group")
      .first()
      .locator(".menu-item-input")
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

const slugWithPerson = (title: string, menu: object, person?: object) =>
  [encode(title), encode(menu), ...(person ? [encode(person)] : [])].join(":");

test.describe("Compare filters and people", () => {
  test("filters to conflicts and labels columns with names", async ({ page }) => {
    const a = slugWithPerson(
      "Ours",
      { G: [{ item: "Kissing", value: "must-have" }, { item: "Dancing", value: "maybe" }] },
      { name: "Ana" }
    );
    const b = slugWithPerson(
      "Ours",
      { G: [{ item: "kissing", value: "off-limits" }, { item: "Dancing", value: "maybe" }] },
      { name: "Ben" }
    );
    await page.goto(`/compare?encoded=${encodeURIComponent(a)}&encoded=${encodeURIComponent(b)}`);
    const grid = page.locator(".compare-page-grid");
    await expect(grid.locator(".menu-item-compare")).toHaveCount(2);
    await expect(grid.getByRole("img", { name: "Ana: Must Have" })).toBeVisible();
    await expect(grid.getByRole("img", { name: "Ben: Off Limits" })).toBeVisible();

    await page.getByRole("group", { name: "Show items" }).getByRole("button", { name: /^Conflicts/ }).click();
    await expect(grid.locator(".menu-item-compare")).toHaveCount(1);
    await expect(grid).toContainText("Kissing");
    // Both Maybe: a quick check, not a conversation.
    await page.getByRole("group", { name: "Show items" }).getByRole("button", { name: /^Quick checks/ }).click();
    await expect(grid.locator(".menu-item-compare")).toHaveCount(1);
    await expect(grid).toContainText("Dancing");
  });
});

test.describe("Library details and person info", () => {
  test("person info is saved, shared in the menu link only, and shown in the Library", async ({
    page,
  }) => {
    await page.goto(menuPath("Mine", { G: [{ item: "Alpha", value: "maybe" }, { item: "Beta" }] }));
    await page.getByLabel("Your name").fill("Sam");
    await page.getByLabel("Pronouns").fill("they/them");
    await expect(page.locator(".save-status")).toHaveText(/Saved/);

    const { menuSlug, templateSlug } = await getShareValues(page);
    expect(menuSlug.split(":")).toHaveLength(3);
    expect(templateSlug.split(":")).toHaveLength(2);

    await page.goto("/library");
    const tile = page.locator(".menu-tile").filter({ hasText: "Mine" });
    await expect(tile).toContainText("Sam (they/them)");
    await expect(tile).toContainText("2 in 1 group");
    await expect(tile.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1");
    await expect(tile).toContainText(/just now|minute/);

    await page.getByLabel("Search").fill("nothing-matches");
    await expect(page.locator(".menu-tile")).toHaveCount(0);
  });
});

test.describe("Share dialog", () => {
  test("explains each link and compares with a pasted link", async ({ page }) => {
    await page.goto(menuPath("Ours", { G: [{ item: "Alpha", value: "must-have" }] }));
    await page.getByRole("button", { name: "Share", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: 'Share "Ours"' });
    await expect(dialog.getByRole("heading", { name: /Invite someone/ })).toBeVisible();
    await expect(dialog).toContainText("no answers");
    await expect(dialog).toContainText("Anyone with this link can see them");
    // Focus stays in the dialog and Escape closes it.
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);

    await page.getByRole("button", { name: "Share", exact: true }).click();
    const theirs = `${encode("Theirs")}:${encode({ G: [{ item: "alpha", value: "off-limits" }] })}`;
    await dialog.getByLabel(/Paste it to compare/).fill(theirs);
    await dialog.getByRole("button", { name: "Compare" }).click();
    await page.waitForURL("**/compare**");
    await expect(page.locator(".compare-page-grid")).toBeVisible();
    await expect(page.getByRole("group", { name: "Show items" }).getByRole("button", { name: /^Conflicts/ })).toContainText("1");
  });
});
