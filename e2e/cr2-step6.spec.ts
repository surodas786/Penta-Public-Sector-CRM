/**
 * CR2 step 6 browser check: the administrator sets notification timing and
 * the management summary recipients, and sees which emails are mandatory and
 * who receives each. A link of the kind an email carries leads to sign-in,
 * then back to the linked page, where access is checked again: someone
 * without access sees "Not available". Nothing is sent (capture transport).
 */
import { expect, test, type Page } from '@playwright/test';

const PASSWORD = process.env.SEED_DEFAULT_PASSWORD ?? 'Synthetic-Dev-2026';
const OPPORTUNITY = 'Municipal Service Portal';

test.describe.configure({ mode: 'serial' });

async function signInHere(page: Page, email: string) {
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test('an administrator sets notification timing; security emails stay on', async ({ page }) => {
  await page.goto('/sign-in');
  await signInHere(page, 'admin@example.com');
  await page.waitForURL(/\/administration$/);

  const templates = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Email templates' }) });
  const passwordChanged = templates.getByRole('row').filter({ hasText: 'Password changed' });
  await expect(passwordChanged.getByText(/Always on \(security\)/)).toBeVisible();
  await expect(templates.getByRole('row').filter({ hasText: 'Team summary' }).getByText(/^Off/)).toBeVisible();
  await expect(templates.getByRole('row').filter({ hasText: 'EOI deadline approaching' }).getByText(/Sent to: The opportunity's owner only/)).toBeVisible();

  await passwordChanged.getByRole('button', { name: 'Edit' }).click();
  const editor = page.getByRole('dialog');
  await expect(editor.getByText(/cannot be turned off/)).toBeVisible();
  await expect(editor.getByLabel('Send this email')).toHaveCount(0);
  await editor.getByRole('button', { name: 'Cancel' }).click();

  const timing = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Notification timing' }) });
  await expect(timing.getByText('From 09:00 Bangladesh time')).toBeVisible();
  await timing.getByRole('button', { name: 'Edit timing' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('EOI deadline reminder (hours)').fill('96');
  await dialog.getByRole('button', { name: 'Save timing' }).click();
  await expect(dialog.getByText(/Use at most 72 hours/)).toBeVisible();
  await dialog.getByLabel('EOI deadline reminder (hours)').fill('48');
  await dialog.getByLabel('Summaries', { exact: true }).selectOption('daily');
  await dialog.getByRole('checkbox', { name: /Arif Rahman/ }).check();
  await page.screenshot({ path: 'docs/evidence/cr/cr2-step6-timing-dialog.png' });
  await dialog.getByRole('button', { name: 'Save timing' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(timing.getByText(/EOI 48 h/)).toBeVisible();
  await expect(timing.getByText('Every day')).toBeVisible();
  await expect(timing.getByText('Arif Rahman')).toBeVisible();
  await timing.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'docs/evidence/cr/cr2-step6-timing.png' });
});

test('an email link needs sign-in, returns to its page, and is checked for access again', async ({ page }) => {
  // Find the record's address as its owner would receive it.
  await page.goto('/sign-in');
  await signInHere(page, 'rafiq.hasan@example.com');
  await page.waitForURL(/\/dashboard$/);
  await page.goto('/opportunities?view=table');
  await page.locator('#main-content').getByRole('button', { name: new RegExp(`^${OPPORTUNITY}$`) }).click();
  await expect(page.getByRole('heading', { name: OPPORTUNITY })).toBeVisible();
  const link = `${new URL(page.url()).pathname}?tab=procurement`;
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForURL(/\/sign-in$/);

  // Signed out: the link asks for sign-in, then opens the linked tab.
  await page.goto(link);
  await page.waitForURL(/\/sign-in$/);
  await signInHere(page, 'rafiq.hasan@example.com');
  await page.waitForURL((url) => `${url.pathname}${url.search}` === link);
  await expect(page.getByRole('heading', { name: OPPORTUNITY })).toBeVisible();
  await expect(page.getByRole('tab', { name: /Software Procurement/ })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForURL(/\/sign-in$/);

  // Someone without access to the record gets the standard "Not available".
  await page.goto(link);
  await page.waitForURL(/\/sign-in$/);
  await signInHere(page, 'imran.hossain@example.com');
  await page.waitForURL((url) => `${url.pathname}${url.search}` === link);
  await expect(page.getByRole('heading', { name: 'Not available' })).toBeVisible();
  await expect(page.getByText(OPPORTUNITY)).toHaveCount(0);
  await page.screenshot({ path: 'docs/evidence/cr/cr2-step6-link-no-access.png' });
});
