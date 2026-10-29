/**
 * Changing an opportunity's procuring organization from the edit dialog
 * (product decision, 27 October 2026).
 *
 * The owner changes it after confirming the linked-contacts popup, which
 * lists the contacts that stay linked; cancelling the popup keeps the form
 * open and changes nothing. A Section Lead sees the field disabled. The rules
 * themselves are proved in server/tests/edit.test.ts.
 */
import { expect, test, type Page } from '@playwright/test';

const PASSWORD = process.env.SEED_DEFAULT_PASSWORD ?? 'Synthetic-Dev-2026';
const RAFIQ = 'rafiq.hasan@example.com';
const NADIA = 'nadia.islam@example.com';

const PORTAL = 'Municipal Service Portal'; // Rafiq; contacts Golam Mostafa and Laila Arjumand
const FROM = 'Sylvan Hills City Corporation';
const TO = 'Department of Civic Records';

test.describe.configure({ mode: 'serial' });

async function openPortalEdit(page: Page, email: string) {
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/dashboard$/);
  await page.goto('/opportunities');
  await page.getByRole('button', { name: new RegExp(PORTAL) }).first().click();
  await expect(page.getByRole('heading', { name: PORTAL })).toBeVisible();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const dialog = page.getByRole('dialog').filter({ hasText: 'Edit opportunity' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test('the owner changes the organization after the linked-contacts popup', async ({ page }) => {
  const dialog = await openPortalEdit(page, RAFIQ);
  const organization = dialog.getByLabel('Procuring organization');
  await expect(organization).toBeEnabled();
  await expect(organization.locator('option:checked')).toHaveText(FROM);

  await organization.selectOption({ label: TO });
  await dialog.getByRole('button', { name: 'Save changes' }).click();

  const popup = page.getByRole('dialog').filter({ hasText: 'Change the procuring organization?' });
  await expect(popup).toBeVisible();
  await expect(popup).toContainText('Golam Mostafa');
  await expect(popup).toContainText('Laila Arjumand');
  await expect(popup).toContainText('They stay linked');

  // Cancel returns to the form with the choice kept, and saves nothing.
  await popup.getByRole('button', { name: 'Cancel' }).click();
  await expect(popup).toBeHidden();
  await expect(dialog).toBeVisible();
  await expect(organization.locator('option:checked')).toHaveText(TO);

  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await popup.getByRole('button', { name: 'Change organization' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(`${TO} · Owner`)).toBeVisible();

  await page.reload();
  await expect(page.getByText(`${TO} · Owner`)).toBeVisible();
  await page.getByRole('tab', { name: /Contacts/ }).click();
  await expect(page.getByText('Golam Mostafa').first()).toBeVisible();
});

test('a Section Lead sees the organization but cannot change it', async ({ page }) => {
  const dialog = await openPortalEdit(page, NADIA);
  await expect(dialog.getByLabel('Procuring organization')).toBeDisabled();
  await expect(dialog).toContainText('Only the owner, Rafiq Hasan, can change the organization.');
});
