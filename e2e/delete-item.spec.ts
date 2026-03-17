import { test, expect, Page } from '@playwright/test';
import { setupLogCapture } from './helpers';

/**
 * Helper function to add a group to the menu
 */
async function addGroup(page: Page, groupName: string) {
  const groupInput = page.locator('input.new-group-title').last();
  await groupInput.click();
  await groupInput.pressSequentially(groupName);
  await page.locator('body').click({ position: { x: 10, y: 10 } });
  await page.waitForTimeout(1000);
}

/**
 * Helper function to add an item to a group
 */
async function addItem(page: Page, itemName: string) {
  const itemInput = page.locator('input.menu-item-input').last();
  await itemInput.click();
  await itemInput.pressSequentially(itemName);
  await page.locator('body').click({ position: { x: 10, y: 10 } });
  await page.waitForTimeout(500);
}

test.describe('Delete Menu Item', () => {

  test('User can delete an item from a group using the delete button', async ({ page }) => {
    await setupLogCapture(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(5000);

    // Navigate to menu creation
    await page.click('text=Create New Menu');
    await page.waitForURL('**/menu**');

    await page.fill('input.menu-title', 'Delete Test Menu');

    // Add a group
    await addGroup(page, 'Test Group');
    await page.waitForTimeout(1000);

    // Add three items
    await addItem(page, 'Item A');
    await addItem(page, 'Item B');
    await addItem(page, 'Item C');
    await page.waitForTimeout(1000);

    // Verify all 3 items exist (plus the empty "new item" input = 4 total)
    const menuGroup = page.locator('.menu-group').first();
    const itemInputs = menuGroup.locator('input.menu-item-input');
    await expect(itemInputs).toHaveCount(4);

    // Verify delete buttons exist for the 3 real items (not the "new item" row)
    const deleteButtons = menuGroup.locator('button.menu-item-delete');
    await expect(deleteButtons).toHaveCount(3);

    // Delete the second item ("Item B") by clicking its delete button
    await deleteButtons.nth(1).click();
    await page.waitForTimeout(1000);

    // Verify only 2 real items remain (plus empty "new item" input = 3 total)
    await expect(itemInputs).toHaveCount(3);

    // Verify "Item B" is gone and "Item A" and "Item C" remain
    await expect(itemInputs.nth(0)).toHaveValue('Item A');
    await expect(itemInputs.nth(1)).toHaveValue('Item C');

    // Verify only 2 delete buttons remain
    await expect(deleteButtons).toHaveCount(2);

    console.log('✅ Successfully deleted item and verified remaining items');
  });

  test('Remaining items are still editable after deletion', async ({ page }) => {
    await setupLogCapture(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(5000);

    // Navigate to menu creation
    await page.click('text=Create New Menu');
    await page.waitForURL('**/menu**');

    await page.fill('input.menu-title', 'Edit After Delete Menu');

    // Add a group
    await addGroup(page, 'Editable Group');
    await page.waitForTimeout(1000);

    // Add two items
    await addItem(page, 'First Item');
    await addItem(page, 'Second Item');
    await page.waitForTimeout(1000);

    const menuGroup = page.locator('.menu-group').first();
    const deleteButtons = menuGroup.locator('button.menu-item-delete');

    // Delete the first item
    await deleteButtons.first().click();
    await page.waitForTimeout(1000);

    // Verify the remaining item is "Second Item"
    const itemInputs = menuGroup.locator('input.menu-item-input');
    await expect(itemInputs.first()).toHaveValue('Second Item');

    // Edit the remaining item
    await itemInputs.first().click();
    await itemInputs.first().fill('Edited Second Item');
    await page.locator('body').click({ position: { x: 10, y: 10 } });
    await page.waitForTimeout(500);

    // Verify the edit persisted
    await expect(itemInputs.first()).toHaveValue('Edited Second Item');

    console.log('✅ Remaining items are editable after deletion');
  });

});
