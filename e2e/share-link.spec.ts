import { test, expect, Page } from "@playwright/test";

/**
 * Helper: add a group by filling the last new-group-title input.
 * Returns the 0-based index of the newly created group in the .menu-group list.
 */
async function addGroup(page: Page, groupName: string): Promise<number> {
  const beforeCount = await page.locator(".menu-group").count();
  const groupInput = page.locator("input.new-group-title").last();
  await groupInput.click();
  await groupInput.fill(groupName);
  await page.waitForTimeout(500);
  return beforeCount - 1;
}

/**
 * Helper: get a group locator by its 0-based index.
 */
function getGroup(page: Page, index: number) {
  return page.locator(".menu-group").nth(index);
}

/**
 * Helper: add an item to a group.
 */
async function addItemToGroup(
  page: Page,
  groupLocator: ReturnType<Page["locator"]>,
  itemName: string
) {
  const itemInput = groupLocator.locator("input.menu-item-input").last();
  await itemInput.click();
  await itemInput.fill(itemName);
  await page.waitForTimeout(500);
}

/**
 * Helper: set the preference on the most recently added item in a group.
 * The last .menu-item is the empty "add new" row, so we target second-to-last.
 */
async function setItemPreference(
  page: Page,
  groupLocator: ReturnType<Page["locator"]>,
  value: string
) {
  const menuItems = groupLocator.locator(".menu-item");
  const count = await menuItems.count();
  const target = menuItems.nth(count - 2);
  await target.locator("select").selectOption(value);
  await page.waitForTimeout(300);
}

test.describe("Share Link Loading", () => {
  test("share link loads menu in another browser context", async ({
    browser,
  }) => {
    const context1 = await browser.newContext({ storageState: undefined });
    const context2 = await browser.newContext({ storageState: undefined });
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    try {
      // Browser 1: Create a menu
      await page1.goto("/menu");
      await page1.waitForLoadState("networkidle");
      await expect(page1.locator("input.menu-title")).toBeVisible({
        timeout: 15000,
      });

      await page1.fill("input.menu-title", "My Shared Menu");
      const groupIdx = await addGroup(page1, "Communication");
      await page1.waitForTimeout(500);

      const group = getGroup(page1, groupIdx);

      await addItemToGroup(page1, group, "Daily check-ins");
      await setItemPreference(page1, group, "must-have");

      await addItemToGroup(page1, group, "Weekly date night");
      await setItemPreference(page1, group, "like-to-have");

      await addItemToGroup(page1, group, "Shared journal");
      await setItemPreference(page1, group, "maybe");

      await page1.waitForTimeout(1000);

      // Get the share URL (first share input = menu link)
      const shareInputs = page1.locator("input.share-input");
      await expect(shareInputs.first()).toBeVisible({ timeout: 10000 });
      const shareUrl = await shareInputs.nth(0).inputValue();
      expect(shareUrl).toContain("/menu?encoded=");

      // Browser 2: Open the share link
      // Extract the path+query from the full URL since baseURL handles the host
      const urlObj = new URL(shareUrl);
      await page2.goto(urlObj.pathname + urlObj.search);
      await page2.waitForLoadState("networkidle");
      await expect(page2.locator("input.menu-title")).toBeVisible({
        timeout: 15000,
      });
      await page2.waitForTimeout(2000);

      // Verify title matches
      const title2 = await page2.locator("input.menu-title").inputValue();
      expect(title2).toBe("My Shared Menu");

      // Verify group exists
      const group2 = getGroup(page2, 0);
      const groupTitle2 = await group2
        .locator("input.new-group-title")
        .inputValue();
      expect(groupTitle2).toBe("Communication");

      // Verify items exist with correct text
      const items2 = group2.locator("input.menu-item-input");
      // 3 items + 1 empty "add new" = 4 inputs
      const itemCount = await items2.count();
      expect(itemCount).toBe(4);
      expect(await items2.nth(0).inputValue()).toBe("Daily check-ins");
      expect(await items2.nth(1).inputValue()).toBe("Weekly date night");
      expect(await items2.nth(2).inputValue()).toBe("Shared journal");

      // Verify preferences match
      const selects2 = group2.locator(".menu-item select");
      expect(await selects2.nth(0).inputValue()).toBe("must-have");
      expect(await selects2.nth(1).inputValue()).toBe("like-to-have");
      expect(await selects2.nth(2).inputValue()).toBe("maybe");
    } finally {
      await context1.close();
      await context2.close();
    }
  });

  test("template share link loads menu without preferences", async ({
    browser,
  }) => {
    const context1 = await browser.newContext({ storageState: undefined });
    const context2 = await browser.newContext({ storageState: undefined });
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    try {
      // Browser 1: Create a menu with preferences
      await page1.goto("/menu");
      await page1.waitForLoadState("networkidle");
      await expect(page1.locator("input.menu-title")).toBeVisible({
        timeout: 15000,
      });

      await page1.fill("input.menu-title", "Template Test Menu");
      const groupIdx = await addGroup(page1, "Boundaries");
      await page1.waitForTimeout(500);

      const group = getGroup(page1, groupIdx);

      await addItemToGroup(page1, group, "Cohabitation");
      await setItemPreference(page1, group, "must-have");

      await addItemToGroup(page1, group, "Shared finances");
      await setItemPreference(page1, group, "off-limits");

      await addItemToGroup(page1, group, "Pet names");
      await setItemPreference(page1, group, "like-to-have");

      await page1.waitForTimeout(1000);

      const shareInputs = page1.locator("input.share-input");
      await expect(shareInputs.first()).toBeVisible({ timeout: 10000 });

      // Get the template URL (third share input, index 2)
      const templateUrl = await shareInputs.nth(2).inputValue();
      expect(templateUrl).toContain("/menu?encoded=");

      // Verify template URL differs from menu URL
      const menuUrl = await shareInputs.nth(0).inputValue();
      expect(templateUrl).not.toBe(menuUrl);

      // Browser 2: Open the template URL
      const urlObj = new URL(templateUrl);
      await page2.goto(urlObj.pathname + urlObj.search);
      await page2.waitForLoadState("networkidle");
      await expect(page2.locator("input.menu-title")).toBeVisible({
        timeout: 15000,
      });
      await page2.waitForTimeout(2000);

      // Verify title matches
      const title2 = await page2.locator("input.menu-title").inputValue();
      expect(title2).toBe("Template Test Menu");

      // Verify group exists
      const group2 = getGroup(page2, 0);
      const groupTitle2 = await group2
        .locator("input.new-group-title")
        .inputValue();
      expect(groupTitle2).toBe("Boundaries");

      // Verify items exist with correct text
      const items2 = group2.locator("input.menu-item-input");
      expect(await items2.nth(0).inputValue()).toBe("Cohabitation");
      expect(await items2.nth(1).inputValue()).toBe("Shared finances");
      expect(await items2.nth(2).inputValue()).toBe("Pet names");

      // Verify ALL preferences are stripped (should be unset / "---")
      const selects2 = group2.locator(".menu-item select");
      for (let i = 0; i < 3; i++) {
        const val = await selects2.nth(i).inputValue();
        // The template strips values, so select should be the "---" option (undefined/empty)
        expect(val).not.toBe("must-have");
        expect(val).not.toBe("like-to-have");
        expect(val).not.toBe("maybe");
        expect(val).not.toBe("off-limits");
      }
    } finally {
      await context1.close();
      await context2.close();
    }
  });

  test("share link with multiple groups transfers correctly", async ({
    browser,
  }) => {
    const context1 = await browser.newContext({ storageState: undefined });
    const context2 = await browser.newContext({ storageState: undefined });
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    try {
      // Browser 1: Create a complex menu with multiple groups
      await page1.goto("/menu");
      await page1.waitForLoadState("networkidle");
      await expect(page1.locator("input.menu-title")).toBeVisible({
        timeout: 15000,
      });

      await page1.fill("input.menu-title", "Complex Multi-Group Menu");

      // Group 1: Physical
      const g1Idx = await addGroup(page1, "Physical");
      await page1.waitForTimeout(500);
      const g1 = getGroup(page1, g1Idx);
      await addItemToGroup(page1, g1, "Holding hands");
      await setItemPreference(page1, g1, "must-have");
      await addItemToGroup(page1, g1, "Kissing");
      await setItemPreference(page1, g1, "like-to-have");

      // Group 2: Emotional
      const g2Idx = await addGroup(page1, "Emotional");
      await page1.waitForTimeout(500);
      const g2 = getGroup(page1, g2Idx);
      await addItemToGroup(page1, g2, "Vulnerability");
      await setItemPreference(page1, g2, "maybe");
      await addItemToGroup(page1, g2, "Daily support");
      await setItemPreference(page1, g2, "must-have");

      // Group 3: Social
      const g3Idx = await addGroup(page1, "Social");
      await page1.waitForTimeout(500);
      const g3 = getGroup(page1, g3Idx);
      await addItemToGroup(page1, g3, "Meeting family");
      await setItemPreference(page1, g3, "off-limits");
      await addItemToGroup(page1, g3, "Public displays");
      await setItemPreference(page1, g3, "like-to-have");
      await addItemToGroup(page1, g3, "Social media posts");
      await setItemPreference(page1, g3, "maybe");

      await page1.waitForTimeout(1000);

      // Get the share URL
      const shareInputs = page1.locator("input.share-input");
      await expect(shareInputs.first()).toBeVisible({ timeout: 10000 });
      const shareUrl = await shareInputs.nth(0).inputValue();

      // Browser 2: Open the share link
      const urlObj = new URL(shareUrl);
      await page2.goto(urlObj.pathname + urlObj.search);
      await page2.waitForLoadState("networkidle");
      await expect(page2.locator("input.menu-title")).toBeVisible({
        timeout: 15000,
      });
      await page2.waitForTimeout(2000);

      // Verify title
      const title2 = await page2.locator("input.menu-title").inputValue();
      expect(title2).toBe("Complex Multi-Group Menu");

      // Verify we have 3 groups + 1 empty "add new" = 4 total
      const groupCount = await page2.locator(".menu-group").count();
      expect(groupCount).toBe(4);

      // Verify Group 1: Physical
      const pg2g1 = getGroup(page2, 0);
      expect(await pg2g1.locator("input.new-group-title").inputValue()).toBe(
        "Physical"
      );
      const g1Items = pg2g1.locator("input.menu-item-input");
      expect(await g1Items.nth(0).inputValue()).toBe("Holding hands");
      expect(await g1Items.nth(1).inputValue()).toBe("Kissing");
      const g1Selects = pg2g1.locator(".menu-item select");
      expect(await g1Selects.nth(0).inputValue()).toBe("must-have");
      expect(await g1Selects.nth(1).inputValue()).toBe("like-to-have");

      // Verify Group 2: Emotional
      const pg2g2 = getGroup(page2, 1);
      expect(await pg2g2.locator("input.new-group-title").inputValue()).toBe(
        "Emotional"
      );
      const g2Items = pg2g2.locator("input.menu-item-input");
      expect(await g2Items.nth(0).inputValue()).toBe("Vulnerability");
      expect(await g2Items.nth(1).inputValue()).toBe("Daily support");
      const g2Selects = pg2g2.locator(".menu-item select");
      expect(await g2Selects.nth(0).inputValue()).toBe("maybe");
      expect(await g2Selects.nth(1).inputValue()).toBe("must-have");

      // Verify Group 3: Social
      const pg2g3 = getGroup(page2, 2);
      expect(await pg2g3.locator("input.new-group-title").inputValue()).toBe(
        "Social"
      );
      const g3Items = pg2g3.locator("input.menu-item-input");
      expect(await g3Items.nth(0).inputValue()).toBe("Meeting family");
      expect(await g3Items.nth(1).inputValue()).toBe("Public displays");
      expect(await g3Items.nth(2).inputValue()).toBe("Social media posts");
      const g3Selects = pg2g3.locator(".menu-item select");
      expect(await g3Selects.nth(0).inputValue()).toBe("off-limits");
      expect(await g3Selects.nth(1).inputValue()).toBe("like-to-have");
      expect(await g3Selects.nth(2).inputValue()).toBe("maybe");
    } finally {
      await context1.close();
      await context2.close();
    }
  });

  test("library tile link loads menu with correct content", async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: undefined });
    const page = await context.newPage();

    try {
      // Create a menu
      await page.goto("/menu");
      await page.waitForLoadState("networkidle");
      await expect(page.locator("input.menu-title")).toBeVisible({
        timeout: 15000,
      });

      await page.fill("input.menu-title", "Library Round-Trip");
      const groupIdx = await addGroup(page, "Favorites");
      await page.waitForTimeout(500);

      const group = getGroup(page, groupIdx);

      await addItemToGroup(page, group, "Movie nights");
      await setItemPreference(page, group, "must-have");

      await addItemToGroup(page, group, "Cooking together");
      await setItemPreference(page, group, "like-to-have");

      await page.waitForTimeout(1000);

      // Navigate to Library
      await page.click('a:has-text("Library")');
      await page.waitForURL("/");
      await page.waitForTimeout(1000);

      // Verify the menu tile appears
      const tile = page.locator(".menu-tile").filter({ hasText: "Library Round-Trip" });
      await expect(tile).toBeVisible({ timeout: 10000 });

      // Click the View link on the tile
      await tile.locator('a:has-text("View")').click();
      await page.waitForURL("**/menu**");
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(2000);

      // Verify the menu loaded correctly
      const loadedTitle = await page.locator("input.menu-title").inputValue();
      expect(loadedTitle).toBe("Library Round-Trip");

      // Verify group
      const loadedGroup = getGroup(page, 0);
      const groupTitle = await loadedGroup
        .locator("input.new-group-title")
        .inputValue();
      expect(groupTitle).toBe("Favorites");

      // Verify items
      const items = loadedGroup.locator("input.menu-item-input");
      expect(await items.nth(0).inputValue()).toBe("Movie nights");
      expect(await items.nth(1).inputValue()).toBe("Cooking together");

      // Verify preferences
      const selects = loadedGroup.locator(".menu-item select");
      expect(await selects.nth(0).inputValue()).toBe("must-have");
      expect(await selects.nth(1).inputValue()).toBe("like-to-have");
    } finally {
      await context.close();
    }
  });

  test("share link from tab 1 loads correctly in tab 2 of same browser", async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: undefined });
    const page1 = await context.newPage();
    const page2 = await context.newPage();

    try {
      // Tab 1: Create a menu
      await page1.goto("/menu");
      await expect(page1.locator("input.menu-title")).toBeVisible({
        timeout: 30000,
      });

      await page1.fill("input.menu-title", "Same Browser Menu");
      const groupIdx = await addGroup(page1, "Activities");
      await page1.waitForTimeout(500);

      const group = getGroup(page1, groupIdx);

      await addItemToGroup(page1, group, "Hiking");
      await setItemPreference(page1, group, "must-have");

      await addItemToGroup(page1, group, "Gaming");
      await setItemPreference(page1, group, "maybe");

      await page1.waitForTimeout(1000);

      // Get the share URL
      const shareInputs = page1.locator("input.share-input");
      await expect(shareInputs.first()).toBeVisible({ timeout: 10000 });
      const shareUrl = await shareInputs.nth(0).inputValue();
      expect(shareUrl).toContain("/menu?encoded=");

      // Tab 2: Open the share link (same browser context = shared localStorage)
      // Use domcontentloaded instead of networkidle because the IPFS node
      // keeps making peer discovery requests that prevent networkidle.
      // The share link data is fully self-contained in the URL and loads synchronously.
      const urlObj = new URL(shareUrl);
      await page2.goto(urlObj.pathname + urlObj.search, {
        waitUntil: "domcontentloaded",
      });
      await expect(page2.locator("input.menu-title")).toBeVisible({
        timeout: 30000,
      });
      await page2.waitForTimeout(2000);

      // Verify title
      const title2 = await page2.locator("input.menu-title").inputValue();
      expect(title2).toBe("Same Browser Menu");

      // Verify group
      const group2 = getGroup(page2, 0);
      expect(
        await group2.locator("input.new-group-title").inputValue()
      ).toBe("Activities");

      // Verify items
      const items2 = group2.locator("input.menu-item-input");
      expect(await items2.nth(0).inputValue()).toBe("Hiking");
      expect(await items2.nth(1).inputValue()).toBe("Gaming");

      // Verify preferences
      const selects2 = group2.locator(".menu-item select");
      expect(await selects2.nth(0).inputValue()).toBe("must-have");
      expect(await selects2.nth(1).inputValue()).toBe("maybe");
    } finally {
      await context.close();
    }
  });
});
