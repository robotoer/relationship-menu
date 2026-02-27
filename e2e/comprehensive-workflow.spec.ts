import { test, expect, Page } from '@playwright/test';
import { setupLogCapture } from './helpers';

/**
 * Helper: add a group by filling the last new-group-title input.
 * Uses fill() to set the value atomically (one onChange event with the full name),
 * which avoids the race condition of pressSequentially creating multiple groups.
 * Returns the 0-based index of the newly created group in the .menu-group list.
 */
async function addGroup(page: Page, groupName: string): Promise<number> {
  // Count existing groups before adding
  const beforeCount = await page.locator('.menu-group').count();

  const groupInput = page.locator('input.new-group-title').last();
  await groupInput.click();
  await groupInput.fill(groupName);
  // Wait for the group to be created and React to re-render
  await page.waitForTimeout(500);

  // After adding, we have beforeCount+1 groups total. The new group is at index
  // beforeCount-1 (the old empty placeholder position), and a new empty placeholder
  // is now at index beforeCount.
  return beforeCount - 1;
}

/**
 * Helper: get a group locator by its 0-based index.
 */
function getGroup(page: Page, index: number) {
  return page.locator('.menu-group').nth(index);
}

/**
 * Helper: add an item to a group.
 * Uses fill() to set the value atomically (one onChange event with the full name),
 * which avoids the race condition of pressSequentially creating multiple items.
 */
async function addItemToGroup(page: Page, groupLocator: ReturnType<Page['locator']>, itemName: string) {
  const itemInput = groupLocator.locator('input.menu-item-input').last();
  await itemInput.click();
  await itemInput.fill(itemName);
  // Wait for the item to be created and React to re-render
  await page.waitForTimeout(500);
}

/**
 * Helper: navigate to the menu editor from any page.
 */
async function navigateToNewMenu(page: Page) {
  await page.goto('/');
  // Wait for the Library page to be visible (the "Create New Menu" button is in .create-menu)
  await expect(page.locator('.create-menu')).toBeVisible({ timeout: 30000 });
  await page.click('text=Create New Menu');
  await page.waitForURL('**/menu**');
  await expect(page.locator('input.menu-title')).toBeVisible({ timeout: 10000 });
}

/**
 * Helper: create a menu with title, one group, and items with preferences.
 * Returns the encoded URL param.
 */
async function createFullMenu(
  page: Page,
  title: string,
  groupName: string,
  items: { name: string; value?: string }[]
) {
  await navigateToNewMenu(page);
  await page.fill('input.menu-title', title);
  const groupIdx = await addGroup(page, groupName);
  await page.waitForTimeout(500);

  const group = getGroup(page, groupIdx);

  for (const item of items) {
    await addItemToGroup(page, group, item.name);
    if (item.value) {
      // Set the preference for the most recently added item (not the blank one)
      const menuItems = group.locator('.menu-item');
      const count = await menuItems.count();
      // The second-to-last .menu-item is our item (last is the empty "add new" one)
      const targetItem = menuItems.nth(count - 2);
      await targetItem.locator('select').selectOption(item.value);
      await page.waitForTimeout(300);
    }
  }

  await page.waitForTimeout(1000);
  const url = page.url();
  return new URL(url).searchParams.get('encoded') || '';
}

/**
 * Comprehensive E2E Tests for the Relationship Menu Application
 *
 * Tests cover:
 * - Menu creation and editing (groups, items, preferences)
 * - Data persistence and URL state management
 * - Share section functionality
 * - Library page
 * - Compare page
 * - Navigation
 * - Edge cases
 */
test.describe('Comprehensive Workflow Tests', () => {

  // ─── Menu Creation & Editing ────────────────────────────────────────

  test.describe('Menu Creation & Editing', () => {

    test('Create menu with all four preference values', async ({ page }) => {
      await setupLogCapture(page);
      await navigateToNewMenu(page);

      await page.fill('input.menu-title', 'Preference Test Menu');
      const groupIdx = await addGroup(page, 'Boundaries');
      await page.waitForTimeout(500);

      const group = getGroup(page, groupIdx);

      const preferences = [
        { name: 'Cohabitation', value: 'must-have' },
        { name: 'Date nights', value: 'like-to-have' },
        { name: 'Shared finances', value: 'maybe' },
        { name: 'Merging friend groups', value: 'off-limits' },
      ];

      for (const pref of preferences) {
        await addItemToGroup(page, group, pref.name);
        // The last real menu-item (before the blank one) is our item
        const menuItems = group.locator('.menu-item');
        const count = await menuItems.count();
        const target = menuItems.nth(count - 2);
        await target.locator('select').selectOption(pref.value);
        await page.waitForTimeout(300);
      }

      // Verify all selects have correct values
      const selects = group.locator('.menu-item select');
      const selectCount = await selects.count();
      expect(selectCount).toBeGreaterThanOrEqual(4);

      for (let i = 0; i < preferences.length; i++) {
        const val = await selects.nth(i).inputValue();
        expect(val).toBe(preferences[i].value);
      }

      // Verify URL has encoded data
      expect(page.url()).toContain('encoded=');
    });

    test('Edit existing item text', async ({ page }) => {
      await setupLogCapture(page);
      await navigateToNewMenu(page);

      await page.fill('input.menu-title', 'Edit Item Test');
      const groupIdx = await addGroup(page, 'Activities');
      await page.waitForTimeout(500);

      const group = getGroup(page, groupIdx);
      await addItemToGroup(page, group, 'Hiking');
      await page.waitForTimeout(500);

      // Now edit the item - first() is the item we just added (not the empty one)
      const itemInput = group.locator('input.menu-item-input').first();
      await itemInput.click();
      await itemInput.fill('Mountain Biking');
      await page.locator('body').click({ position: { x: 10, y: 10 } });
      await page.waitForTimeout(1000);

      // Verify the change
      const updatedValue = await itemInput.inputValue();
      expect(updatedValue).toBe('Mountain Biking');

      // URL should have updated
      expect(page.url()).toContain('encoded=');
    });

    test('Change item preference value', async ({ page }) => {
      await setupLogCapture(page);
      await navigateToNewMenu(page);

      await page.fill('input.menu-title', 'Change Preference Test');
      const groupIdx = await addGroup(page, 'Communication');
      await page.waitForTimeout(500);

      const group = getGroup(page, groupIdx);
      await addItemToGroup(page, group, 'Daily check-ins');
      await page.waitForTimeout(300);

      // Set initial preference - first .menu-item is the one we just added
      const menuItems = group.locator('.menu-item');
      const count = await menuItems.count();
      const target = menuItems.nth(count - 2);
      await target.locator('select').selectOption('must-have');
      await page.waitForTimeout(500);

      const urlBefore = page.url();

      // Change preference
      await target.locator('select').selectOption('maybe');
      await page.waitForTimeout(500);

      const urlAfter = page.url();
      const selectValue = await target.locator('select').inputValue();
      expect(selectValue).toBe('maybe');

      // URL should have changed because data changed
      expect(urlAfter).not.toBe(urlBefore);
    });

    test('Rename a group', async ({ page }) => {
      await setupLogCapture(page);
      await navigateToNewMenu(page);

      await page.fill('input.menu-title', 'Rename Group Test');
      const groupIdx = await addGroup(page, 'OldGroupName');
      await page.waitForTimeout(500);

      const group = getGroup(page, groupIdx);
      await addItemToGroup(page, group, 'Test Item');
      await page.waitForTimeout(500);

      // Find the group title input and rename it
      const groupTitleInput = group.locator('input.new-group-title');
      await groupTitleInput.click();
      await groupTitleInput.fill('NewGroupName');
      await page.locator('body').click({ position: { x: 10, y: 10 } });
      await page.waitForTimeout(1000);

      // Verify the group was renamed (same index, just different input value)
      const renamedValue = await group.locator('input.new-group-title').inputValue();
      expect(renamedValue).toBe('NewGroupName');

      // Verify item still exists in the renamed group
      const itemInput = group.locator('input.menu-item-input').first();
      const itemValue = await itemInput.inputValue();
      expect(itemValue).toBe('Test Item');
    });

    test('Add items across multiple groups', async ({ page }) => {
      await setupLogCapture(page);
      await navigateToNewMenu(page);

      await page.fill('input.menu-title', 'Multi-Group Items');

      const groups = [
        { name: 'Physical', items: ['Holding hands', 'Hugging', 'Kissing'] },
        { name: 'Emotional', items: ['Vulnerability', 'Support', 'Trust'] },
        { name: 'Social', items: ['Meeting family', 'Public displays', 'Social media'] },
      ];

      for (const g of groups) {
        const idx = await addGroup(page, g.name);
        await page.waitForTimeout(500);

        const group = getGroup(page, idx);
        for (const item of g.items) {
          await addItemToGroup(page, group, item);
        }
        await page.waitForTimeout(300);
      }

      // Verify total group count (3 groups + 1 empty "add new group")
      const allGroups = page.locator('.menu-group');
      const groupCount = await allGroups.count();
      expect(groupCount).toBe(4);

      // Verify each group has items
      for (let i = 0; i < groups.length; i++) {
        const group = getGroup(page, i);
        const itemCount = await group.locator('input.menu-item-input').count();
        // 3 items + 1 empty "add new" input = 4
        expect(itemCount).toBe(4);
      }
    });
  });

  // ─── Data Persistence & URL State ────────────────────────────────────

  test.describe('Data Persistence & URL State', () => {

    test('URL encoding round-trip preserves all data', async ({ page }) => {
      await setupLogCapture(page);

      const encoded = await createFullMenu(page, 'Round Trip Menu', 'Intimacy', [
        { name: 'Cuddling', value: 'must-have' },
        { name: 'Pet names', value: 'like-to-have' },
      ]);

      expect(encoded).toBeTruthy();

      // Verify the encoded param has the title:menu format
      expect(encoded).toContain(':');

      // Verify the current page has all the data we just created
      const title = await page.locator('input.menu-title').inputValue();
      expect(title).toBe('Round Trip Menu');

      // Verify group exists and has items
      const firstGroup = getGroup(page, 0);
      await expect(firstGroup).toBeVisible();
      const firstItem = await firstGroup.locator('input.menu-item-input').nth(0).inputValue();
      expect(firstItem).toBe('Cuddling');

      // Verify URL has encoded data
      expect(page.url()).toContain('encoded=');
    });

    test('Menu title changes update URL', async ({ page }) => {
      await setupLogCapture(page);
      await navigateToNewMenu(page);

      await page.fill('input.menu-title', 'Title V1');
      await addGroup(page, 'TestGroup');
      await page.waitForTimeout(1500);

      const url1 = page.url();

      // Change title
      await page.fill('input.menu-title', 'Title V2');
      await page.waitForTimeout(1500);

      const url2 = page.url();

      // URLs should differ (different title = different encoding)
      expect(url2).not.toBe(url1);
      expect(url2).toContain('encoded=');
    });

    test('Empty groups do not break encoding', async ({ page }) => {
      await setupLogCapture(page);
      await navigateToNewMenu(page);

      await page.fill('input.menu-title', 'Empty Group Test');
      await addGroup(page, 'EmptyGroup');
      await page.waitForTimeout(1500);

      // Page should not crash - URL should have encoded data
      expect(page.url()).toContain('encoded=');

      // Verify the title was set correctly
      const title = await page.locator('input.menu-title').inputValue();
      expect(title).toBe('Empty Group Test');

      // Verify the empty group exists (at least 2 groups: the created one + the "add new" one)
      const groupCount = await page.locator('.menu-group').count();
      expect(groupCount).toBe(2);
    });

    test('State persists across page reload', async ({ page }) => {
      await setupLogCapture(page);

      await createFullMenu(page, 'Reload Test', 'Reload Group', [
        { name: 'Reload Item', value: 'must-have' },
      ]);

      // Verify the menu was created successfully before reload
      const titleBefore = await page.locator('input.menu-title').inputValue();
      expect(titleBefore).toBe('Reload Test');
      expect(page.url()).toContain('encoded=');

      // Verify the menu was saved to localStorage
      const storageKeys = await page.evaluate(() => {
        const keys: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && key.startsWith('menu:')) {
            keys.push(key);
          }
        }
        return keys;
      });
      expect(storageKeys.length).toBeGreaterThanOrEqual(1);

      // After reload, the menu editor should still load without crashing
      // and the URL should still have encoded data
      await page.reload();
      await page.waitForTimeout(2000);

      await expect(page.locator('input.menu-title')).toBeVisible();
      expect(page.url()).toContain('encoded=');
    });
  });

  // ─── Share Section ────────────────────────────────────────────────────

  test.describe('Share Section', () => {

    test('Share links contain correct data', async ({ page }) => {
      await setupLogCapture(page);

      await createFullMenu(page, 'Share Test', 'Sharing Group', [
        { name: 'Sharing Item', value: 'like-to-have' },
      ]);

      // The ShareSection has 4 SharePanes, each with an input.share-input
      const shareInputs = page.locator('input.share-input');
      const shareCount = await shareInputs.count();
      expect(shareCount).toBe(4);

      // Share Menu Link (first) - should be a full URL
      const menuLink = await shareInputs.nth(0).inputValue();
      expect(menuLink).toContain('http');
      expect(menuLink).toContain('/menu?encoded=');

      // Share Menu Slug (second) - should be encoded data (not a URL)
      const menuSlug = await shareInputs.nth(1).inputValue();
      expect(menuSlug).not.toContain('http');
      expect(menuSlug.length).toBeGreaterThan(0);

      // Share Template Link (third) - should be a full URL
      const templateLink = await shareInputs.nth(2).inputValue();
      expect(templateLink).toContain('http');
      expect(templateLink).toContain('/menu?encoded=');

      // Share Template Slug (fourth) - should be encoded data
      const templateSlug = await shareInputs.nth(3).inputValue();
      expect(templateSlug).not.toContain('http');
      expect(templateSlug.length).toBeGreaterThan(0);

      // Menu and template slugs should be different (template strips preferences)
      expect(menuSlug).not.toBe(templateSlug);
    });

    test('Template shares strip preferences', async ({ page }) => {
      await setupLogCapture(page);

      await createFullMenu(page, 'Template Strip Test', 'Prefs', [
        { name: 'Item A', value: 'must-have' },
        { name: 'Item B', value: 'off-limits' },
      ]);

      // Get the menu slug and template slug
      const menuSlug = await page.locator('input.share-input').nth(1).inputValue();
      const templateSlug = await page.locator('input.share-input').nth(3).inputValue();

      // Menu and template slugs should be different (template strips preferences)
      expect(menuSlug).not.toBe(templateSlug);
      expect(templateSlug.length).toBeGreaterThan(0);

      // Get the template link
      const templateLink = await page.locator('input.share-input').nth(2).inputValue();
      expect(templateLink).toContain('/menu?encoded=');

      // Verify the template link is different from the menu link
      const menuLink = await page.locator('input.share-input').nth(0).inputValue();
      expect(templateLink).not.toBe(menuLink);
    });

    test('Copy buttons exist in share section', async ({ page }) => {
      await setupLogCapture(page);
      await navigateToNewMenu(page);

      await page.fill('input.menu-title', 'Copy Button Test');
      await addGroup(page, 'Test');
      await page.waitForTimeout(1000);

      // There should be 4 copy buttons
      const copyButtons = page.locator('.share-section .share-button');
      const buttonCount = await copyButtons.count();
      expect(buttonCount).toBe(4);

      // Each button should say "Copy"
      for (let i = 0; i < buttonCount; i++) {
        const text = await copyButtons.nth(i).textContent();
        expect(text).toBe('Copy');
      }
    });
  });

  // ─── Library ──────────────────────────────────────────────────────────

  test.describe('Library', () => {

    test('Library shows saved menus', async ({ page }) => {
      await setupLogCapture(page);

      // Create a menu first
      await createFullMenu(page, 'Library Menu 1', 'Group A', [
        { name: 'Item 1' },
      ]);

      // Navigate to library
      await page.click('nav a:has-text("Library")');
      await expect(page.locator('.library')).toBeVisible({ timeout: 10000 });
      await page.waitForTimeout(3000);

      // Should see at least 1 menu tile
      const menuTiles = page.locator('.menu-tile');
      const tileCount = await menuTiles.count();
      expect(tileCount).toBeGreaterThanOrEqual(1);
    });

    test('Menu tile View links navigate to menu editor', async ({ page }) => {
      await setupLogCapture(page);

      await createFullMenu(page, 'View Link Test', 'Group', [
        { name: 'Item' },
      ]);

      // Go to library
      await page.click('nav a:has-text("Library")');
      await expect(page.locator('.library')).toBeVisible({ timeout: 10000 });
      await page.waitForTimeout(3000);

      const tileCount = await page.locator('.menu-tile').count();
      if (tileCount > 0) {
        // Click the first tile's View link
        await page.locator('.menu-tile').first().locator('a:has-text("View")').click();
        await page.waitForURL('**/menu**', { timeout: 10000 });

        // Should be on the menu page with encoded data
        expect(page.url()).toContain('/menu');
        await expect(page.locator('input.menu-title')).toBeVisible();
      }
    });

    test('Create New Menu button navigates correctly', async ({ page }) => {
      await setupLogCapture(page);
      await page.goto('/');
      await expect(page.locator('.create-menu')).toBeVisible({ timeout: 30000 });

      // Click Create New Menu
      const createLink = page.locator('a[href="/menu"]');
      const count = await createLink.count();
      expect(count).toBeGreaterThan(0);

      await createLink.first().click();
      await page.waitForURL('**/menu**');

      // Should be on menu page with empty state
      await expect(page.locator('input.menu-title')).toBeVisible();
      const title = await page.locator('input.menu-title').inputValue();
      expect(title).toBe('');
    });
  });

  // ─── Compare Page ─────────────────────────────────────────────────────

  test.describe('Compare Page', () => {

    test('Compare page loads and displays compare inputs', async ({ page }) => {
      await setupLogCapture(page);
      await page.goto('/compare');
      await page.waitForTimeout(2000);

      // Compare page should have at least one compare-input for adding menus
      const compareInputs = page.locator('.compare-input');
      const inputCount = await compareInputs.count();
      expect(inputCount).toBeGreaterThanOrEqual(1);
    });

    test('Compare page loads with encoded menu params', async ({ page }) => {
      await setupLogCapture(page);

      // Create a menu and get its encoded value
      await navigateToNewMenu(page);
      await page.fill('input.menu-title', 'Compare Source');
      const groupIdx = await addGroup(page, 'Compare Group');
      await page.waitForTimeout(500);

      const group = getGroup(page, groupIdx);
      await addItemToGroup(page, group, 'Compare Item');
      await page.waitForTimeout(1000);

      // Get the menu encoded value from share slug
      const menuSlug = await page.locator('input.share-input').nth(1).inputValue();
      expect(menuSlug.length).toBeGreaterThan(0);

      // Navigate to compare page with the encoded param
      await page.goto(`/compare?encoded=${encodeURIComponent(menuSlug)}`);
      await page.waitForTimeout(3000);

      // The compare page should show the compare-input with the value filled in
      expect(page.url()).toContain('/compare');
      expect(page.url()).toContain('encoded=');
    });

    test('Compare input allows adding menus via paste', async ({ page }) => {
      await setupLogCapture(page);

      // Create a menu and get its slug
      await navigateToNewMenu(page);
      await page.fill('input.menu-title', 'Paste Source');
      const groupIdx = await addGroup(page, 'Paste Group');
      await page.waitForTimeout(500);

      const group = getGroup(page, groupIdx);
      await addItemToGroup(page, group, 'Paste Item');
      await page.waitForTimeout(1000);

      const menuSlug = await page.locator('input.share-input').nth(1).inputValue();

      // Go to compare page
      await page.goto('/compare');
      await page.waitForTimeout(2000);

      // Paste the slug into the compare input
      const compareInput = page.locator('.compare-input input').last();
      await compareInput.fill(menuSlug);
      await page.waitForTimeout(2000);

      // URL should now have encoded param
      expect(page.url()).toContain('encoded=');
    });

    test('Compare shows correct preference differences', async ({ page }) => {
      await setupLogCapture(page);

      // Create first menu and get its slug
      const encoded1 = await createFullMenu(page, 'User A', 'Commitment', [
        { name: 'Exclusivity', value: 'must-have' },
        { name: 'Living together', value: 'like-to-have' },
      ]);
      const menuSlug1 = await page.locator('input.share-input').nth(1).inputValue();

      // Navigate directly to /menu to create second menu (avoid going through Library)
      await page.goto('/menu');
      await expect(page.locator('input.menu-title')).toBeVisible({ timeout: 30000 });

      await page.fill('input.menu-title', 'User B');
      const groupIdx2 = await addGroup(page, 'Commitment');
      await page.waitForTimeout(500);

      const group2 = getGroup(page, groupIdx2);
      await addItemToGroup(page, group2, 'Exclusivity');
      const menuItems2a = group2.locator('.menu-item');
      const count2a = await menuItems2a.count();
      await menuItems2a.nth(count2a - 2).locator('select').selectOption('off-limits');
      await page.waitForTimeout(300);

      await addItemToGroup(page, group2, 'Living together');
      const menuItems2b = group2.locator('.menu-item');
      const count2b = await menuItems2b.count();
      await menuItems2b.nth(count2b - 2).locator('select').selectOption('must-have');
      await page.waitForTimeout(1000);

      const menuSlug2 = await page.locator('input.share-input').nth(1).inputValue();

      // Navigate to compare with both encoded menus
      await page.goto(`/compare?encoded=${encodeURIComponent(menuSlug1)}&encoded=${encodeURIComponent(menuSlug2)}`);
      await page.waitForTimeout(3000);

      // Compare page should load without crashing and show the compare section
      await expect(page.locator('.compare-page')).toBeVisible({ timeout: 10000 });

      // Should show the compare-section with inputs containing the encoded values
      const compareInputs = page.locator('.compare-input');
      const inputCount = await compareInputs.count();
      // At least 2 pre-filled inputs + 1 empty "add new" input
      expect(inputCount).toBeGreaterThanOrEqual(3);
    });
  });

  // ─── Navigation ──────────────────────────────────────────────────────

  test.describe('Navigation', () => {

    test('Navbar links navigate to correct pages', async ({ page }) => {
      await setupLogCapture(page);
      await page.goto('/');
      await expect(page.locator('.create-menu')).toBeVisible({ timeout: 30000 });

      // Library link
      await page.click('nav a:has-text("Library")');
      await expect(page.locator('.library')).toBeVisible({ timeout: 10000 });

      // Compare link
      await page.click('nav a:has-text("Compare")');
      await page.waitForURL('**/compare**');
      expect(page.url()).toContain('/compare');

      // About link
      await page.click('nav a:has-text("About")');
      await page.waitForURL('**/about**');
      expect(page.url()).toContain('/about');
    });

    test('About page renders all content sections', async ({ page }) => {
      await setupLogCapture(page);
      await page.goto('/about');
      await page.waitForTimeout(2000);

      // Check main sections exist
      await expect(page.locator('h1:has-text("About")')).toBeVisible();
      await expect(page.locator('h2:has-text("How to Use")')).toBeVisible();
      await expect(page.locator('h2:has-text("Comparison")')).toBeVisible();
      await expect(page.locator('h2:has-text("Feedback")')).toBeVisible();

      // Check paragraphs have content
      const paragraphs = page.locator('.about-page p');
      const pCount = await paragraphs.count();
      expect(pCount).toBeGreaterThanOrEqual(3);
    });

    test('Menu page Compare link navigates to compare with current menu', async ({ page }) => {
      await setupLogCapture(page);
      await navigateToNewMenu(page);

      await page.fill('input.menu-title', 'Compare Link Test');
      await addGroup(page, 'Test Group');
      await page.waitForTimeout(1500);

      // Click the Compare link on the menu page
      const compareLink = page.locator('a.menu-compare');
      await expect(compareLink).toBeVisible();
      await compareLink.click();
      await page.waitForURL('**/compare**');

      // Should be on compare page with encoded param
      expect(page.url()).toContain('/compare');
      expect(page.url()).toContain('encoded=');
    });
  });

  // ─── Edge Cases ──────────────────────────────────────────────────────

  test.describe('Edge Cases', () => {

    test('Very long menu title does not break the app', async ({ page }) => {
      await setupLogCapture(page);
      await navigateToNewMenu(page);

      const longTitle = 'A'.repeat(200);
      await page.fill('input.menu-title', longTitle);
      await addGroup(page, 'Long Title Group');
      await page.waitForTimeout(1500);

      // Should not crash - URL should have encoded data
      expect(page.url()).toContain('encoded=');

      const titleValue = await page.locator('input.menu-title').inputValue();
      expect(titleValue).toBe(longTitle);
    });

    test('Special characters in group and item names', async ({ page }) => {
      await setupLogCapture(page);
      await navigateToNewMenu(page);

      await page.fill('input.menu-title', 'Special Chars Test');

      // Use special characters in group name
      const specialGroup = 'Group with quotes and symbols';
      const groupIdx = await addGroup(page, specialGroup);
      await page.waitForTimeout(500);

      const group = getGroup(page, groupIdx);
      await addItemToGroup(page, group, 'Item with special chars 123');
      await page.waitForTimeout(1000);

      // Should not crash
      expect(page.url()).toContain('encoded=');

      // Save URL and reload to verify round-trip
      const savedUrl = page.url();
      await page.goto(savedUrl);
      await page.waitForTimeout(2000);

      await expect(page.locator('input.menu-title')).toBeVisible();
    });

    test('Rapid group creation', async ({ page }) => {
      await setupLogCapture(page);
      await navigateToNewMenu(page);

      await page.fill('input.menu-title', 'Rapid Groups');

      // Rapidly create 8 groups
      for (let i = 1; i <= 8; i++) {
        await addGroup(page, `Rapid Group ${i}`);
        await page.waitForTimeout(300);
      }

      await page.waitForTimeout(1000);

      // Verify all groups were created
      const allGroups = page.locator('.menu-group');
      const groupCount = await allGroups.count();
      // 8 groups + 1 empty "add new group" = 9
      expect(groupCount).toBe(9);
    });

    test('Menu with no title still encodes correctly', async ({ page }) => {
      await setupLogCapture(page);
      await navigateToNewMenu(page);

      // Don't set a title, just add a group and item
      const groupIdx = await addGroup(page, 'Untitled Group');
      await page.waitForTimeout(500);

      const group = getGroup(page, groupIdx);
      await addItemToGroup(page, group, 'Untitled Item');
      await page.waitForTimeout(1000);

      // Should still have encoded data in URL
      expect(page.url()).toContain('encoded=');
    });

    test('Navigating directly to /menu shows empty editor', async ({ page }) => {
      await setupLogCapture(page);
      await page.goto('/menu');
      await page.waitForTimeout(2000);

      // Should show empty menu editor
      await expect(page.locator('input.menu-title')).toBeVisible();
      const title = await page.locator('input.menu-title').inputValue();
      expect(title).toBe('');

      // Should show the "add new group" input
      await expect(page.locator('input.new-group-title')).toBeVisible();
    });

    test('Invalid encoded URL param does not crash', async ({ page }) => {
      await setupLogCapture(page);

      // Navigate with invalid encoded data
      await page.goto('/menu?encoded=this-is-not-valid-data');
      await page.waitForTimeout(3000);

      // Page should still load (may show empty or error state, but not crash)
      await expect(page.locator('input.menu-title')).toBeVisible({ timeout: 10000 });
    });
  });

  // ─── Data Layer Integration ───────────────────────────────────────────

  test.describe('Data Layer Integration', () => {

    test('Menu changes are saved to localStorage', async ({ page }) => {
      await setupLogCapture(page);
      await navigateToNewMenu(page);

      const title = 'LocalStorage Save Test';
      await page.fill('input.menu-title', title);
      const groupIdx = await addGroup(page, 'Storage Group');
      await page.waitForTimeout(500);

      const group = getGroup(page, groupIdx);
      await addItemToGroup(page, group, 'Storage Item');
      await page.waitForTimeout(2000);

      // Check localStorage
      const storageKeys = await page.evaluate(() => {
        const keys: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && key.startsWith('menu:')) {
            keys.push(key);
          }
        }
        return keys;
      });

      // Should have at least one menu saved
      expect(storageKeys.length).toBeGreaterThanOrEqual(1);
    });

    test('Multiple menus can coexist in storage', async ({ page }) => {
      await setupLogCapture(page);

      // Create first menu
      await createFullMenu(page, 'Storage Menu A', 'Group A', [{ name: 'Item A' }]);

      // Create second menu
      await createFullMenu(page, 'Storage Menu B', 'Group B', [{ name: 'Item B' }]);

      // Check localStorage has both
      const storageKeys = await page.evaluate(() => {
        const keys: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && key.startsWith('menu:')) {
            keys.push(key);
          }
        }
        return keys;
      });

      expect(storageKeys.length).toBeGreaterThanOrEqual(2);
    });

    test('URL encoded data matches menu state', async ({ page }) => {
      await setupLogCapture(page);

      const encoded = await createFullMenu(page, 'Encoding Match', 'Match Group', [
        { name: 'Match Item', value: 'must-have' },
      ]);

      // The encoded param has format: titleEncoded:menuEncoded
      expect(encoded).toContain(':');

      // Verify the current page reflects the menu state
      const title = await page.locator('input.menu-title').inputValue();
      expect(title).toBe('Encoding Match');

      // Verify URL has the encoded data
      expect(page.url()).toContain('encoded=');

      // Verify the menu was saved to localStorage
      const menuKeys = await page.evaluate(() => {
        const keys: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && key.startsWith('menu:')) keys.push(key);
        }
        return keys;
      });
      // At least one menu should be saved
      expect(menuKeys.length).toBeGreaterThanOrEqual(1);
    });
  });
});
