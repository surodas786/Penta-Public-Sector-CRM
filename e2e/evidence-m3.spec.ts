/**
 * Milestone 3 screenshot evidence. Run by `npm run evidence` as a separate
 * Playwright run (fresh servers and fixtures), so together with the M1/M2
 * captures it stays under the login rate limit. Two sign-ins.
 */
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const PASSWORD = process.env.SEED_DEFAULT_PASSWORD ?? 'Synthetic-Dev-2026';
const OUTPUT = path.resolve('docs', 'evidence');

async function signIn(page: Page, email: string) {
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/(dashboard|administration)$/);
}

test('capture Milestone 3 screens', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const shot = (name: string) => page.screenshot({ path: path.join(OUTPUT, `${name}.png`), fullPage: true });

  // --- Administrator --------------------------------------------------------
  await signIn(page, 'admin@example.com');
  await expect(page.getByRole('row').filter({ hasText: 'rafiq.hasan@example.com' })).toBeVisible();
  await expect(page.getByText('Account created').or(page.getByText('No administrative changes recorded yet.'))).toBeVisible();
  await shot('15-administration-desktop-1440');

  await page.getByRole('button', { name: 'Add user' }).click();
  const form = page.getByRole('dialog');
  await form.getByLabel('Full name').fill('Lamia Chowdhury');
  await form.getByLabel('Email').fill('lamia.chowdhury@example.com');
  await form.getByLabel('Section').selectOption({ label: 'Government Applications' });
  await shot('16-add-user-desktop-1440');
  await form.getByRole('button', { name: 'Add user' }).click();
  const link = page.getByRole('dialog');
  await expect(link.getByRole('heading', { name: 'Invitation link' })).toBeVisible();
  const url = await link.getByLabel('Link').inputValue();
  await shot('17-invitation-link-desktop-1440');
  await link.getByRole('button', { name: 'Done' }).click();

  const government = page.locator('div.rounded-md').filter({ hasText: 'Government Applications' }).first();
  await government.getByRole('button', { name: 'Replace lead' }).click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: /Replace lead/ })).toBeVisible();
  await shot('18-replace-lead-desktop-1440');
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'Sign out' }).click();

  // --- The invited person's page (no sign-in needed) -----------------------
  await page.goto(url);
  await expect(page.getByRole('heading', { name: 'Choose your password' })).toBeVisible();
  await shot('19-set-password-desktop-1440');

  // --- Management --------------------------------------------------------------
  await signIn(page, 'arif.rahman@example.com');
  await page.goto('/team');
  await expect(page.getByRole('heading', { name: 'Team Management' })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'Rafiq Hasan' })).toBeVisible();
  await shot('20-team-management-desktop-1440');

  await page.goto('/opportunities?view=table');
  await page.locator('#main-content').getByRole('button', { name: /^Municipal Service Portal$/ }).click();
  await page.locator('#main-content').getByRole('button', { name: 'Reassign / Transfer' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('New owner').selectOption({ label: 'Imran Hossain' });
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await expect(dialog.getByRole('heading', { name: 'Confirm cross-section transfer' })).toBeVisible();
  await shot('21-cross-section-transfer-desktop-1440');
});
