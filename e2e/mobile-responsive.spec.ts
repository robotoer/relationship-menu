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

/**
 * Helper: check that the page has no horizontal overflow.
 */
async function expectNoHorizontalOverflow(page: Page) {
  const hasOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth
  );
  expect(hasOverflow).toBe(false);
}

test.describe("Mobile Responsive", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
  });

  test("hamburger menu toggles navigation on mobile", async ({ page }) => {
    await page.goto("/menu");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("input.menu-title")).toBeVisible({
      timeout: 15000,
    });

    // Hamburger button should be visible on mobile
    const hamburger = page.locator("button.hamburger");
    await expect(hamburger).toBeVisible();

    // Desktop nav links should be hidden
    await expect(page.locator(".navbar-desktop-link").first()).not.toBeVisible();

    // Mobile links panel should not be in the DOM initially (conditionally rendered)
    await expect(page.locator(".navbar-mobile-links")).toHaveCount(0);

    // Click hamburger to open mobile menu
    await hamburger.click();

    // Mobile links panel should now be visible
    const mobileLinks = page.locator(".navbar-mobile-links");
    await expect(mobileLinks).toBeVisible();

    // Click the Library link
    await mobileLinks.locator('a:has-text("Library")').click();
    await page.waitForURL("/");

    // After navigation, the mobile menu should close (panel removed from DOM)
    await expect(page.locator(".navbar-mobile-links")).toHaveCount(0);
  });

  test("can create and share menu on mobile", async ({ browser }) => {
    const context1 = await browser.newContext({ storageState: undefined });
    const page1 = await context1.newPage();
    await page1.setViewportSize({ width: 375, height: 667 });

    try {
      await page1.goto("/menu");
      await page1.waitForLoadState("networkidle");
      await expect(page1.locator("input.menu-title")).toBeVisible({
        timeout: 15000,
      });

      // Fill in menu details on mobile
      await page1.fill("input.menu-title", "Mobile Menu Test");
      const groupIdx = await addGroup(page1, "Connection");
      await page1.waitForTimeout(500);

      const group = getGroup(page1, groupIdx);
      await addItemToGroup(page1, group, "Texting daily");
      await setItemPreference(page1, group, "must-have");

      await addItemToGroup(page1, group, "Video calls");
      await setItemPreference(page1, group, "like-to-have");

      await page1.waitForTimeout(1000);

      // Verify share inputs are visible
      const shareInputs = page1.locator("input.share-input");
      await expect(shareInputs.first()).toBeVisible({ timeout: 10000 });

      // Get the share URL
      const shareUrl = await shareInputs.nth(0).inputValue();
      expect(shareUrl).toContain("/menu?encoded=");

      // Open share URL in a new mobile context
      const context2 = await browser.newContext({ storageState: undefined });
      const page2 = await context2.newPage();
      await page2.setViewportSize({ width: 375, height: 667 });

      const urlObj = new URL(shareUrl);
      await page2.goto(urlObj.pathname + urlObj.search);
      await page2.waitForLoadState("networkidle");
      await expect(page2.locator("input.menu-title")).toBeVisible({
        timeout: 15000,
      });
      await page2.waitForTimeout(2000);

      // Verify menu loaded correctly on mobile
      const title2 = await page2.locator("input.menu-title").inputValue();
      expect(title2).toBe("Mobile Menu Test");

      const group2 = getGroup(page2, 0);
      expect(
        await group2.locator("input.new-group-title").inputValue()
      ).toBe("Connection");

      const items2 = group2.locator("input.menu-item-input");
      expect(await items2.nth(0).inputValue()).toBe("Texting daily");
      expect(await items2.nth(1).inputValue()).toBe("Video calls");

      const selects2 = group2.locator(".menu-item select");
      expect(await selects2.nth(0).inputValue()).toBe("must-have");
      expect(await selects2.nth(1).inputValue()).toBe("like-to-have");

      await context2.close();
    } finally {
      await context1.close();
    }
  });

  test("library page displays menus in single column on mobile", async ({
    page,
  }) => {
    // Create a menu first
    await page.goto("/menu");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("input.menu-title")).toBeVisible({
      timeout: 15000,
    });

    await page.fill("input.menu-title", "Mobile Library Test");
    const groupIdx = await addGroup(page, "Basics");
    await page.waitForTimeout(500);
    const group = getGroup(page, groupIdx);
    await addItemToGroup(page, group, "Communication");
    await setItemPreference(page, group, "must-have");
    await page.waitForTimeout(1000);

    // Navigate to Library via hamburger menu
    const hamburger = page.locator("button.hamburger");
    await hamburger.click();
    await page.locator(".navbar-mobile-links").locator('a:has-text("Library")').click();
    await page.waitForURL("/");
    await page.waitForTimeout(1000);

    // Verify the menu tile is visible
    const tile = page
      .locator(".menu-tile")
      .filter({ hasText: "Mobile Library Test" });
    await expect(tile).toBeVisible({ timeout: 10000 });

    // Verify no horizontal scrollbar
    await expectNoHorizontalOverflow(page);
  });

  test("no horizontal overflow on any page at mobile viewport", async ({
    page,
  }) => {
    const pages = ["/", "/menu", "/compare", "/about"];

    for (const path of pages) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(500);
      await expectNoHorizontalOverflow(page);
    }
  });
});

test.describe("Tablet Responsive", () => {
  test("app works correctly at tablet viewport", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });

    // Navigate to /menu
    await page.goto("/menu");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("input.menu-title")).toBeVisible({
      timeout: 15000,
    });

    // Hamburger should NOT be visible at tablet width (768px > 640px breakpoint)
    await expect(page.locator("button.hamburger")).not.toBeVisible();

    // Desktop nav links should be visible
    await expect(page.locator(".navbar-desktop-link").first()).toBeVisible();

    // Create a menu
    await page.fill("input.menu-title", "Tablet Menu Test");
    const groupIdx = await addGroup(page, "Quality Time");
    await page.waitForTimeout(500);
    const group = getGroup(page, groupIdx);
    await addItemToGroup(page, group, "Weekend trips");
    await setItemPreference(page, group, "like-to-have");
    await page.waitForTimeout(1000);

    // Verify no horizontal overflow
    await expectNoHorizontalOverflow(page);

    // Navigate to library using desktop link
    await page.click('a.navbar-desktop-link:has-text("Library")');
    await page.waitForURL("/");
    await page.waitForTimeout(1000);

    // Verify tile displays
    const tile = page
      .locator(".menu-tile")
      .filter({ hasText: "Tablet Menu Test" });
    await expect(tile).toBeVisible({ timeout: 10000 });

    // Verify no horizontal overflow on library
    await expectNoHorizontalOverflow(page);
  });
});

test.describe("Cross-Viewport Sharing", () => {
  test("share link from desktop works on mobile viewport", async ({
    browser,
  }) => {
    // Context 1: Desktop viewport
    const desktopContext = await browser.newContext({ storageState: undefined });
    const desktopPage = await desktopContext.newPage();
    await desktopPage.setViewportSize({ width: 1280, height: 720 });

    // Context 2: Mobile viewport
    const mobileContext = await browser.newContext({ storageState: undefined });
    const mobilePage = await mobileContext.newPage();
    await mobilePage.setViewportSize({ width: 375, height: 667 });

    try {
      // Desktop: Create a menu
      await desktopPage.goto("/menu");
      await desktopPage.waitForLoadState("networkidle");
      await expect(desktopPage.locator("input.menu-title")).toBeVisible({
        timeout: 15000,
      });

      await desktopPage.fill("input.menu-title", "Desktop to Mobile Menu");
      const groupIdx = await addGroup(desktopPage, "Shared Activities");
      await desktopPage.waitForTimeout(500);
      const group = getGroup(desktopPage, groupIdx);

      await addItemToGroup(desktopPage, group, "Cooking together");
      await setItemPreference(desktopPage, group, "must-have");

      await addItemToGroup(desktopPage, group, "Board games");
      await setItemPreference(desktopPage, group, "like-to-have");

      await addItemToGroup(desktopPage, group, "Road trips");
      await setItemPreference(desktopPage, group, "maybe");

      await desktopPage.waitForTimeout(1000);

      // Get the share URL from desktop
      const shareInputs = desktopPage.locator("input.share-input");
      await expect(shareInputs.first()).toBeVisible({ timeout: 10000 });
      const shareUrl = await shareInputs.nth(0).inputValue();
      expect(shareUrl).toContain("/menu?encoded=");

      // Mobile: Open the share link
      const urlObj = new URL(shareUrl);
      await mobilePage.goto(urlObj.pathname + urlObj.search);
      await mobilePage.waitForLoadState("networkidle");
      await expect(mobilePage.locator("input.menu-title")).toBeVisible({
        timeout: 15000,
      });
      await mobilePage.waitForTimeout(2000);

      // Verify menu loads correctly on mobile
      const title = await mobilePage.locator("input.menu-title").inputValue();
      expect(title).toBe("Desktop to Mobile Menu");

      const mobileGroup = getGroup(mobilePage, 0);
      expect(
        await mobileGroup.locator("input.new-group-title").inputValue()
      ).toBe("Shared Activities");

      const items = mobileGroup.locator("input.menu-item-input");
      expect(await items.nth(0).inputValue()).toBe("Cooking together");
      expect(await items.nth(1).inputValue()).toBe("Board games");
      expect(await items.nth(2).inputValue()).toBe("Road trips");

      const selects = mobileGroup.locator(".menu-item select");
      expect(await selects.nth(0).inputValue()).toBe("must-have");
      expect(await selects.nth(1).inputValue()).toBe("like-to-have");
      expect(await selects.nth(2).inputValue()).toBe("maybe");

      // Verify no horizontal overflow on mobile
      await expectNoHorizontalOverflow(mobilePage);
    } finally {
      await desktopContext.close();
      await mobileContext.close();
    }
  });
});
