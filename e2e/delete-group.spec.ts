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

test.describe('Delete Group', () => {

  test('User can delete a menu group using the delete button', async ({ page }) => {
    await setupLogCapture(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(5000);

    // Create a new menu
    await page.click('text=Create New Menu');
    await page.waitForURL('**/menu**');
    await page.fill('input.menu-title', 'Delete Group Test');

    // Add two groups
    await addGroup(page, 'Group To Keep');
    await addGroup(page, 'Group To Delete');
    await page.waitForTimeout(1000);

    // Verify both groups exist (plus the "new group" placeholder)
    const groupsBefore = await page.locator('.menu-group').count();
    expect(groupsBefore).toBe(3); // 2 groups + 1 placeholder

    // Verify the group title inputs contain our group names
    await expect(page.locator('input.new-group-title[value="Group To Keep"]')).toBeVisible();
    await expect(page.locator('input.new-group-title[value="Group To Delete"]')).toBeVisible();

    // Click the delete button for "Group To Delete"
    const deleteButton = page.getByRole('button', { name: 'Delete group: Group To Delete' });
    await expect(deleteButton).toBeVisible();
    await deleteButton.click();
    await page.waitForTimeout(1000);

    // Verify the group was removed
    const groupsAfter = await page.locator('.menu-group').count();
    expect(groupsAfter).toBe(2); // 1 group + 1 placeholder

    // Verify "Group To Keep" still exists
    await expect(page.locator('input.new-group-title[value="Group To Keep"]')).toBeVisible();

    // Verify "Group To Delete" is gone
    await expect(page.locator('input.new-group-title[value="Group To Delete"]')).not.toBeVisible();

    // Verify the URL was updated (still contains encoded data)
    expect(page.url()).toContain('encoded=');

    console.log('✅ Group deleted successfully');
  });

});
