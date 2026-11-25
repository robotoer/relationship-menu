import { Page } from '@playwright/test';

export type ShareValues = {
  menuLink: string;
  menuSlug: string;
  templateLink: string;
  templateSlug: string;
};

/**
 * Opens the menu page's Share dialog, reads its four values by label, and closes it
 * again (the dialog is modal, so it would otherwise block later clicks).
 */
export async function getShareValues(page: Page): Promise<ShareValues> {
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: /^Share / });
  await dialog.waitFor({ state: 'visible', timeout: 10000 });
  const read = (name: string) =>
    dialog.getByRole('textbox', { name, exact: true, includeHidden: true }).inputValue();
  const values = {
    menuLink: await read('Menu link'),
    menuSlug: await read('Menu slug'),
    templateLink: await read('Template link'),
    templateSlug: await read('Template slug'),
  };
  await dialog.getByRole('button', { name: 'Close share dialog' }).click();
  await dialog.waitFor({ state: 'hidden' });
  return values;
}
