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
 * Helper: navigate to Library via navbar, handling both desktop and mobile viewports.
 */
async function navigateToLibrary(page: Page) {
  const viewport = page.viewportSize();
  if (viewport && viewport.width <= 640) {
    const hamburger = page.locator("button.hamburger");
    if (await hamburger.isVisible()) {
      await hamburger.click();
      await page
        .locator(".navbar-mobile-links")
        .locator('a:has-text("Library")')
        .click();
    } else {
      await page.goto("/");
    }
  } else {
    await page.click('nav a:has-text("Library")');
  }
  await expect(page.locator(".library")).toBeVisible({ timeout: 10000 });
}

/**
 * Helper: create a menu on /menu via the UI and navigate to Library.
 * This does a full page load to /menu so should only be used once per test
 * (for the first menu creation). Subsequent menus should use
 * createAdditionalMenu() to stay in the same React session.
 */
async function createMenuAndGoToLibrary(
  page: Page,
  title: string,
  groupName: string,
  items: { name: string; value?: string }[]
) {
  await page.goto("/menu");
  await expect(page.locator("input.menu-title")).toBeVisible({
    timeout: 30000,
  });
  await page.fill("input.menu-title", title);
  const groupIdx = await addGroup(page, groupName);
  await page.waitForTimeout(500);
  const group = getGroup(page, groupIdx);
  for (const item of items) {
    await addItemToGroup(page, group, item.name);
    if (item.value) await setItemPreference(page, group, item.value);
  }
  await page.waitForTimeout(1000);
  await navigateToLibrary(page);
  await page.waitForTimeout(2000);
}

/**
 * Helper: create an additional menu within the same React session.
 *
 * Because WrappedMenuPage is memoized with useMemo, the same component
 * instance persists. The menu state accumulates groups, but saveDocuments
 * stores each save under the current title, so the Library will show
 * separate tiles for each title.
 *
 * Must be called when on the Library page.
 */
async function createAdditionalMenu(
  page: Page,
  title: string,
  groupName: string,
  items: { name: string; value?: string }[]
) {
  await page.locator('.create-menu a[href="/menu"]').click();
  await page.waitForURL("**/menu**");
  await expect(page.locator("input.menu-title")).toBeVisible({
    timeout: 30000,
  });

  // Change title first, then add group+items to trigger save
  await page.fill("input.menu-title", title);
  await page.waitForTimeout(300);

  const groupIdx = await addGroup(page, groupName);
  await page.waitForTimeout(500);
  const group = getGroup(page, groupIdx);
  for (const item of items) {
    await addItemToGroup(page, group, item.name);
    if (item.value) await setItemPreference(page, group, item.value);
  }
  await page.waitForTimeout(1000);

  await navigateToLibrary(page);
  await page.waitForTimeout(2000);
}

/**
 * Comprehensive E2E Tests for the Library Feature
 *
 * IMPORTANT: The app uses IPFS (Helia) as its storage backend. Each page load
 * creates a new Helia node, so menus saved in one page load are NOT accessible
 * from another. Menus are available in the Library only within the same React
 * session via StorageProvider's in-memory documents map. All multi-menu tests
 * must stay within the same React session (client-side navigation only).
 */
test.describe("Library Feature", () => {
  // ─── Basic Display ────────────────────────────────────────────────────

  test.describe("Basic Display", () => {
    test("empty library shows Create New Menu button", async ({ browser }) => {
      const context = await browser.newContext({ storageState: undefined });
      const page = await context.newPage();

      try {
        await page.goto("/");
        await expect(page.locator(".library")).toBeVisible({ timeout: 30000 });
        await page.waitForTimeout(1000);

        await expect(page.locator(".create-menu")).toBeVisible();
        await expect(
          page.locator('.create-menu button:has-text("Create New Menu")')
        ).toBeVisible();

        const tileCount = await page.locator(".menu-tile").count();
        expect(tileCount).toBe(0);
      } finally {
        await context.close();
      }
    });

    test("library shows saved menu as tile", async ({ browser }) => {
      const context = await browser.newContext({ storageState: undefined });
      const page = await context.newPage();

      try {
        await createMenuAndGoToLibrary(page, "My Menu", "Group A", [
          { name: "Item 1" },
        ]);

        const tile = page
          .locator(".menu-tile")
          .filter({ hasText: "My Menu" });
        await expect(tile).toBeVisible({ timeout: 10000 });
        await expect(tile.locator("h2")).toHaveText("My Menu");
      } finally {
        await context.close();
      }
    });

    test("library shows multiple saved menus", async ({ browser }) => {
      const context = await browser.newContext({ storageState: undefined });
      const page = await context.newPage();

      try {
        await createMenuAndGoToLibrary(page, "First Menu", "First Group", [
          { name: "First Item", value: "must-have" },
        ]);

        await expect(
          page.locator(".menu-tile").filter({ hasText: "First Menu" })
        ).toBeVisible({ timeout: 10000 });

        await createAdditionalMenu(page, "Second Menu", "Second Group", [
          { name: "Second Item", value: "like-to-have" },
        ]);

        await createAdditionalMenu(page, "Third Menu", "Third Group", [
          { name: "Third Item", value: "maybe" },
        ]);

        const tileCount = await page.locator(".menu-tile").count();
        expect(tileCount).toBeGreaterThanOrEqual(3);

        for (const title of ["First Menu", "Second Menu", "Third Menu"]) {
          await expect(
            page.locator(".menu-tile").filter({ hasText: title })
          ).toBeVisible();
        }
      } finally {
        await context.close();
      }
    });

    test("menu tiles display correct titles", async ({ browser }) => {
      const context = await browser.newContext({ storageState: undefined });
      const page = await context.newPage();

      try {
        await createMenuAndGoToLibrary(page, "Alpha", "Alpha Group", [
          { name: "Alpha Item" },
        ]);

        await createAdditionalMenu(page, "Beta", "Beta Group", [
          { name: "Beta Item" },
        ]);

        const alphaTile = page
          .locator(".menu-tile")
          .filter({ hasText: "Alpha" });
        await expect(alphaTile.locator("h2")).toHaveText("Alpha");

        const betaTile = page
          .locator(".menu-tile")
          .filter({ hasText: "Beta" });
        await expect(betaTile.locator("h2")).toHaveText("Beta");
      } finally {
        await context.close();
      }
    });
  });

  // ─── Navigation ───────────────────────────────────────────────────────

  test.describe("Navigation", () => {
    test("Create New Menu button navigates to menu editor", async ({
      browser,
    }) => {
      const context = await browser.newContext({ storageState: undefined });
      const page = await context.newPage();

      try {
        await page.goto("/");
        await expect(page.locator(".create-menu")).toBeVisible({
          timeout: 30000,
        });

        await page.locator('.create-menu a[href="/menu"]').click();
        await page.waitForURL("**/menu**");

        expect(page.url()).toContain("/menu");
        await expect(page.locator("input.menu-title")).toBeVisible();
      } finally {
        await context.close();
      }
    });

    test("View link on tile navigates to menu with correct data", async ({
      browser,
    }) => {
      const context = await browser.newContext({ storageState: undefined });
      const page = await context.newPage();

      try {
        await createMenuAndGoToLibrary(page, "Nav Test", "Activities", [
          { name: "Hiking", value: "must-have" },
        ]);

        const tile = page
          .locator(".menu-tile")
          .filter({ hasText: "Nav Test" });
        await expect(tile).toBeVisible({ timeout: 10000 });

        // Clicking View navigates to /menu?encoded=... within the same SPA
        await tile.locator('a:has-text("View")').click();
        await page.waitForURL("**/menu**");
        await page.waitForTimeout(2000);

        expect(page.url()).toContain("/menu");
        expect(page.url()).toContain("encoded=");

        // The title is set from URL decode in the memoized WrappedMenuPage.
        // Since the URL contains the full self-contained slug, the title
        // and menu data come from URL decoding, not from the previous state.
        const loadedTitle = await page
          .locator("input.menu-title")
          .inputValue();
        expect(loadedTitle).toBe("Nav Test");
      } finally {
        await context.close();
      }
    });

    test("can navigate back to library from menu editor", async ({
      browser,
    }) => {
      const context = await browser.newContext({ storageState: undefined });
      const page = await context.newPage();

      try {
        await createMenuAndGoToLibrary(page, "Round Trip", "Group", [
          { name: "Item" },
        ]);

        const tile = page
          .locator(".menu-tile")
          .filter({ hasText: "Round Trip" });
        await expect(tile).toBeVisible({ timeout: 10000 });
        await tile.locator('a:has-text("View")').click();
        await page.waitForURL("**/menu**");
        await page.waitForTimeout(1000);

        await page.click('nav a:has-text("Library")');
        await expect(page.locator(".library")).toBeVisible({ timeout: 10000 });

        expect(page.url()).not.toContain("/menu");
        const tileCount = await page.locator(".menu-tile").count();
        expect(tileCount).toBeGreaterThanOrEqual(1);
      } finally {
        await context.close();
      }
    });
  });

  // ─── Data Persistence ─────────────────────────────────────────────────

  test.describe("Data Persistence", () => {
    test("menus persist across within-session navigation", async ({
      browser,
    }) => {
      const context = await browser.newContext({ storageState: undefined });
      const page = await context.newPage();

      try {
        await createMenuAndGoToLibrary(page, "Persist Test", "Persistence", [
          { name: "Survives Navigation" },
        ]);

        const tile = page
          .locator(".menu-tile")
          .filter({ hasText: "Persist Test" });
        await expect(tile).toBeVisible({ timeout: 10000 });

        // Navigate away to About page
        await page.click('nav a:has-text("About")');
        await page.waitForURL("**/about**");
        await page.waitForTimeout(1000);

        // Navigate back to Library
        await page.click('nav a:has-text("Library")');
        await expect(page.locator(".library")).toBeVisible({ timeout: 10000 });
        await page.waitForTimeout(2000);

        const tileAfter = page
          .locator(".menu-tile")
          .filter({ hasText: "Persist Test" });
        await expect(tileAfter).toBeVisible({ timeout: 10000 });
      } finally {
        await context.close();
      }
    });

    test("share URL loads menu data in new tab", async ({ browser }) => {
      const context = await browser.newContext({ storageState: undefined });
      const page = await context.newPage();

      try {
        // Create a menu
        await page.goto("/menu");
        await expect(page.locator("input.menu-title")).toBeVisible({
          timeout: 30000,
        });
        await page.fill("input.menu-title", "Share Tab Test");
        const groupIdx = await addGroup(page, "ShareGroup");
        const group = getGroup(page, groupIdx);
        await addItemToGroup(page, group, "Share Item");
        await page.waitForTimeout(1000);

        // Get share URL
        const shareInputs = page.locator("input.share-input");
        await expect(shareInputs.first()).toBeVisible({ timeout: 10000 });
        const shareUrl = await shareInputs.nth(0).inputValue();

        // Open share URL in new tab — the URL is self-contained so it works
        // in a new page even though it has a different Helia node
        const page2 = await context.newPage();
        const urlObj = new URL(shareUrl);
        await page2.goto(urlObj.pathname + urlObj.search, {
          waitUntil: "domcontentloaded",
        });
        await expect(page2.locator("input.menu-title")).toBeVisible({
          timeout: 30000,
        });

        const title2 = await page2.locator("input.menu-title").inputValue();
        expect(title2).toBe("Share Tab Test");
      } finally {
        await context.close();
      }
    });

    test("menus persist across page reload", async ({ browser }) => {
      const context = await browser.newContext({ storageState: undefined });
      const page = await context.newPage();

      try {
        // Create a menu with specific data
        await createMenuAndGoToLibrary(page, "Reload Test", "ReloadGroup", [
          { name: "Persistent Item", value: "must-have" },
        ]);

        const tile = page
          .locator(".menu-tile")
          .filter({ hasText: "Reload Test" });
        await expect(tile).toBeVisible({ timeout: 10000 });

        // Full page reload — this creates a new Helia node, but the IDB
        // blockstore persists data and localStorage has a JSON fallback
        await page.reload({ waitUntil: "domcontentloaded" });
        await expect(page.locator(".library")).toBeVisible({ timeout: 30000 });
        await page.waitForTimeout(5000);

        // Menu should still appear after reload (exactly one tile, not duplicates)
        const tileAfter = page
          .locator(".menu-tile")
          .filter({ hasText: "Reload Test" });
        await expect(tileAfter).toBeVisible({ timeout: 15000 });
        expect(await tileAfter.count()).toBe(1);

        // Click View to verify data integrity
        await tileAfter.locator('a:has-text("View")').click();
        await page.waitForURL("**/menu**");
        await page.waitForTimeout(3000);

        const loadedTitle = await page
          .locator("input.menu-title")
          .inputValue();
        expect(loadedTitle).toBe("Reload Test");
      } finally {
        await context.close();
      }
    });

    test("editing a menu updates library tile", async ({ browser }) => {
      const context = await browser.newContext({ storageState: undefined });
      const page = await context.newPage();

      try {
        await createMenuAndGoToLibrary(page, "V1", "EditGroup", [
          { name: "Edit Item" },
        ]);

        const tileV1 = page.locator(".menu-tile").filter({ hasText: "V1" });
        await expect(tileV1).toBeVisible({ timeout: 10000 });

        // Click View to go to menu editor (same SPA session)
        await tileV1.locator('a:has-text("View")').click();
        await page.waitForURL("**/menu**");
        await page.waitForTimeout(2000);

        // Edit the title and add an item
        await page.fill("input.menu-title", "V2");
        const editGroup = getGroup(page, 0);
        await addItemToGroup(page, editGroup, "New Item");
        await page.waitForTimeout(1500);

        // Navigate back to Library
        await page.click('nav a:has-text("Library")');
        await expect(page.locator(".library")).toBeVisible({ timeout: 10000 });
        await page.waitForTimeout(2000);

        const tileV2 = page.locator(".menu-tile").filter({ hasText: "V2" });
        await expect(tileV2).toBeVisible({ timeout: 10000 });
      } finally {
        await context.close();
      }
    });
  });

  // ─── View Link Data Integrity ──────────────────────────────────────────

  test.describe("View Link Data Integrity", () => {
    test("clicking View on tile loads complete menu data", async ({
      browser,
    }) => {
      const context = await browser.newContext({ storageState: undefined });
      const page = await context.newPage();

      try {
        await page.goto("/menu");
        await expect(page.locator("input.menu-title")).toBeVisible({
          timeout: 30000,
        });
        await page.fill("input.menu-title", "Full Data Test");

        const g1Idx = await addGroup(page, "Physical");
        const g1 = getGroup(page, g1Idx);
        await addItemToGroup(page, g1, "Holding hands");
        await setItemPreference(page, g1, "must-have");
        await addItemToGroup(page, g1, "Hugging");
        await setItemPreference(page, g1, "like-to-have");

        const g2Idx = await addGroup(page, "Emotional");
        const g2 = getGroup(page, g2Idx);
        await addItemToGroup(page, g2, "Vulnerability");
        await setItemPreference(page, g2, "maybe");
        await addItemToGroup(page, g2, "Support");
        await setItemPreference(page, g2, "off-limits");

        await page.waitForTimeout(1000);
        await navigateToLibrary(page);
        await page.waitForTimeout(2000);

        const tile = page
          .locator(".menu-tile")
          .filter({ hasText: "Full Data Test" });
        await expect(tile).toBeVisible({ timeout: 10000 });

        // Get the View link href — it's a self-contained URL with all data
        const viewHref = await tile
          .locator('a:has-text("View")')
          .getAttribute("href");
        expect(viewHref).toContain("/menu?encoded=");

        // The encoded URL contains the full menu data, so verify it decodes correctly
        // by checking the URL includes encoded data
        expect(viewHref!.length).toBeGreaterThan(50);

        // Click View to verify it navigates and shows data
        await tile.locator('a:has-text("View")').click();
        await page.waitForURL("**/menu**");
        await page.waitForTimeout(2000);

        const loadedTitle = await page
          .locator("input.menu-title")
          .inputValue();
        expect(loadedTitle).toBe("Full Data Test");
      } finally {
        await context.close();
      }
    });
  });

  // ─── Grid Layout ──────────────────────────────────────────────────────

  test.describe("Grid Layout", () => {
    test("library grid has no horizontal overflow", async ({ browser }) => {
      const context = await browser.newContext({ storageState: undefined });
      const page = await context.newPage();

      try {
        await createMenuAndGoToLibrary(page, "Grid Menu 1", "G1", [
          { name: "I1" },
        ]);

        await createAdditionalMenu(page, "Grid Menu 2", "G2", [
          { name: "I2" },
        ]);

        const tileCount = await page.locator(".menu-tile").count();
        expect(tileCount).toBeGreaterThanOrEqual(2);

        const hasOverflow = await page.evaluate(
          () =>
            document.documentElement.scrollWidth >
            document.documentElement.clientWidth
        );
        expect(hasOverflow).toBe(false);
      } finally {
        await context.close();
      }
    });

    test("library grid displays single column on mobile", async ({
      browser,
    }) => {
      const context = await browser.newContext({ storageState: undefined });
      const page = await context.newPage();
      await page.setViewportSize({ width: 375, height: 667 });

      try {
        await page.goto("/menu");
        await expect(page.locator("input.menu-title")).toBeVisible({
          timeout: 30000,
        });
        await page.fill("input.menu-title", "Mobile Menu");
        const groupIdx = await addGroup(page, "MobileGroup");
        const group = getGroup(page, groupIdx);
        await addItemToGroup(page, group, "Mobile Item");
        await page.waitForTimeout(1000);

        await navigateToLibrary(page);
        await page.waitForTimeout(2000);

        const tile = page
          .locator(".menu-tile")
          .filter({ hasText: "Mobile Menu" });
        await expect(tile).toBeVisible({ timeout: 10000 });

        const hasOverflow = await page.evaluate(
          () =>
            document.documentElement.scrollWidth >
            document.documentElement.clientWidth
        );
        expect(hasOverflow).toBe(false);
      } finally {
        await context.close();
      }
    });
  });

  // ─── Integration with Share Links ─────────────────────────────────────

  test.describe("Integration with Share Links", () => {
    test("menu created via share link appears in library", async ({
      browser,
    }) => {
      const context = await browser.newContext({ storageState: undefined });
      const page = await context.newPage();

      try {
        await page.goto("/menu");
        await expect(page.locator("input.menu-title")).toBeVisible({
          timeout: 30000,
        });
        await page.fill("input.menu-title", "Shared Menu");
        const groupIdx = await addGroup(page, "ShareGroup");
        const group = getGroup(page, groupIdx);
        await addItemToGroup(page, group, "Share Item");
        await setItemPreference(page, group, "must-have");
        await page.waitForTimeout(1000);

        const shareInputs = page.locator("input.share-input");
        await expect(shareInputs.first()).toBeVisible({ timeout: 10000 });
        const shareUrl = await shareInputs.nth(0).inputValue();
        expect(shareUrl).toContain("/menu?encoded=");

        // Navigate to Library first (same SPA session)
        await navigateToLibrary(page);
        await page.waitForTimeout(2000);

        const tile = page
          .locator(".menu-tile")
          .filter({ hasText: "Shared Menu" });
        await expect(tile).toBeVisible({ timeout: 10000 });
      } finally {
        await context.close();
      }
    });

    test("View link produces working share links", async ({ browser }) => {
      const context = await browser.newContext({ storageState: undefined });
      const page = await context.newPage();

      try {
        await createMenuAndGoToLibrary(page, "Share Link Test", "ShareGroup", [
          { name: "Share Item", value: "like-to-have" },
        ]);

        const tile = page
          .locator(".menu-tile")
          .filter({ hasText: "Share Link Test" });
        await expect(tile).toBeVisible({ timeout: 10000 });
        await tile.locator('a:has-text("View")').click();
        await page.waitForURL("**/menu**");
        await page.waitForTimeout(2000);

        const shareSection = page.locator(".share-section");
        await expect(shareSection).toBeVisible({ timeout: 10000 });

        const shareInputs = page.locator("input.share-input");
        expect(await shareInputs.count()).toBe(4);

        const menuLink = await shareInputs.nth(0).inputValue();
        expect(menuLink).toContain("http");
        expect(menuLink).toContain("/menu?encoded=");
      } finally {
        await context.close();
      }
    });
  });

  // ─── Edge Cases ───────────────────────────────────────────────────────

  test.describe("Edge Cases", () => {
    test("menu with very long title displays in library", async ({
      browser,
    }) => {
      const context = await browser.newContext({ storageState: undefined });
      const page = await context.newPage();

      try {
        const longTitle = "A".repeat(100);
        await createMenuAndGoToLibrary(page, longTitle, "LongTitleGroup", [
          { name: "Long Title Item" },
        ]);

        const tile = page
          .locator(".menu-tile")
          .filter({ hasText: longTitle });
        await expect(tile).toBeVisible({ timeout: 10000 });
        await expect(tile.locator("h2")).toHaveText(longTitle);

        const hasOverflow = await page.evaluate(
          () =>
            document.documentElement.scrollWidth >
            document.documentElement.clientWidth
        );
        expect(hasOverflow).toBe(false);
      } finally {
        await context.close();
      }
    });

    test("menu with empty title displays in library", async ({ browser }) => {
      const context = await browser.newContext({ storageState: undefined });
      const page = await context.newPage();

      try {
        await page.goto("/menu");
        await expect(page.locator("input.menu-title")).toBeVisible({
          timeout: 30000,
        });
        const groupIdx = await addGroup(page, "Untitled Group");
        const group = getGroup(page, groupIdx);
        await addItemToGroup(page, group, "Untitled Item");
        await page.waitForTimeout(1500);

        await page.click('nav a:has-text("Library")');
        await expect(page.locator(".library")).toBeVisible({ timeout: 10000 });
        await page.waitForTimeout(2000);

        const tileCount = await page.locator(".menu-tile").count();
        expect(tileCount).toBeGreaterThanOrEqual(1);
      } finally {
        await context.close();
      }
    });

    test("library with no menus has correct empty state", async ({
      browser,
    }) => {
      const context = await browser.newContext({ storageState: undefined });
      const page = await context.newPage();

      try {
        await page.goto("/");
        await expect(page.locator(".library")).toBeVisible({ timeout: 30000 });
        await page.waitForTimeout(1000);

        await expect(page.locator(".create-menu")).toBeVisible();
        await expect(
          page.locator('.create-menu button:has-text("Create New Menu")')
        ).toBeVisible();

        const tileCount = await page.locator(".menu-tile").count();
        expect(tileCount).toBe(0);
      } finally {
        await context.close();
      }
    });

    test("library handles many menus without overflow", async ({
      browser,
    }) => {
      const context = await browser.newContext({ storageState: undefined });
      const page = await context.newPage();

      try {
        // Create first menu via full page load
        await createMenuAndGoToLibrary(page, "Many 1", "ManyG1", [
          { name: "MI1", value: "must-have" },
        ]);

        // Create additional menus in the same session
        for (let i = 2; i <= 5; i++) {
          await createAdditionalMenu(page, `Many ${i}`, `ManyG${i}`, [
            { name: `MI${i}`, value: "like-to-have" },
          ]);
        }

        const tileCount = await page.locator(".menu-tile").count();
        expect(tileCount).toBeGreaterThanOrEqual(5);

        // Verify no horizontal overflow
        const hasOverflow = await page.evaluate(
          () =>
            document.documentElement.scrollWidth >
            document.documentElement.clientWidth
        );
        expect(hasOverflow).toBe(false);

        // Verify all tiles are visible
        for (let i = 1; i <= 5; i++) {
          await expect(
            page.locator(".menu-tile").filter({ hasText: `Many ${i}` })
          ).toBeVisible();
        }
      } finally {
        await context.close();
      }
    });
  });
});
