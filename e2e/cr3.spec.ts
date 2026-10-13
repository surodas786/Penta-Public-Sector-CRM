/**
 * CR3 browser check: a person changes their own password from the top bar.
 *
 * The rules are proved by `server/tests/ownPassword.test.ts`; this checks the
 * dialog end to end. Three sign-ins, well under the login rate limit.
 */
import { expect, test, type Page } from '@playwright/test';

const PASSWORD = process.env.SEED_DEFAULT_PASSWORD ?? 'Synthetic-Dev-2026';
const NEW_PASSWORD = 'a changed and memorable passphrase 2026';
const EMAIL = 'tasnia.karim@example.com';

test.describe.configure({ mode: 'serial' });

async function signIn(page: Page, password: string) {
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(EMAIL);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test('a salesperson changes their own password and signs in with it', async ({ page }) => {
  await signIn(page, PASSWORD);
  await page.waitForURL(/\/dashboard$/);

  await page.getByRole('button', { name: 'Change password' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Change password' })).toBeVisible();

  // A wrong current password is shown next to its field; typed values stay.
  await dialog.getByLabel('Current password').fill('not my password at all');
  await dialog.getByLabel(/^New password/).fill(NEW_PASSWORD);
  await dialog.getByLabel('Repeat the new password').fill(NEW_PASSWORD);
  await dialog.getByRole('button', { name: 'Change password' }).click();
  await expect(dialog.getByText('Your current password is not correct.')).toBeVisible();
  await expect(dialog.getByLabel(/^New password/)).toHaveValue(NEW_PASSWORD);
  await page.screenshot({ path: 'docs/evidence/cr/cr3-change-password-error.png' });

  // A mismatched repeat never reaches the server.
  await dialog.getByLabel('Current password').fill(PASSWORD);
  await dialog.getByLabel('Repeat the new password').fill(`${NEW_PASSWORD}!`);
  await dialog.getByRole('button', { name: 'Change password' }).click();
  await expect(dialog.getByText('The two new passwords do not match.')).toBeVisible();

  await dialog.getByLabel('Repeat the new password').fill(NEW_PASSWORD);
  await dialog.getByRole('button', { name: 'Change password' }).click();
  await expect(page.getByText('Password changed. Your other sessions have been signed out.')).toBeVisible();
  await expect(dialog).toBeHidden();

  // This session continues, and its mutations still pass CSRF: signing out
  // is itself a protected POST.
  await page.getByRole('link', { name: 'Opportunities' }).click();
  await expect(page).toHaveURL(/\/opportunities/);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/sign-in$/);

  await signIn(page, PASSWORD);
  await expect(page.getByText('Email address or password is incorrect.')).toBeVisible();

  await signIn(page, NEW_PASSWORD);
  await page.waitForURL(/\/dashboard$/);
});
