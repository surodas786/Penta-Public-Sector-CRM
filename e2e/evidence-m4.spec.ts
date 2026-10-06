/**
 * Milestone 4 screenshot evidence. Run by `npm run evidence` as its own
 * Playwright run on fresh fixtures. Two sign-ins.
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
  // Sales roles land on the dashboard (M6), then open the opportunity list.
  await page.waitForURL(/\/dashboard$/);
  await page.goto('/opportunities');
  await expect(page.getByRole('heading', { name: 'Opportunities' })).toBeVisible();
}

test('capture Milestone 4 screens', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const main = page.locator('#main-content');
  const shot = (name: string) => page.screenshot({ path: path.join(OUTPUT, `${name}.png`), fullPage: true });

  // --- Salesperson ------------------------------------------------------------
  await signIn(page, 'rafiq.hasan@example.com');
  await page.goto('/organizations');
  await expect(main.getByRole('row').filter({ hasText: 'Sylvan Hills City Corporation' })).toBeVisible();
  await shot('22-organizations-directory-desktop-1440');

  await main.getByRole('row').filter({ hasText: 'Sylvan Hills City Corporation' }).click();
  await expect(main.getByText('1 within your access')).toBeVisible();
  await shot('23-organization-detail-desktop-1440');

  await page.goto('/organizations?tab=contacts&q=Farzana');
  await main.getByRole('row').filter({ hasText: 'Farzana Yasmin' }).click();
  await expect(main.getByText(/Shared with opportunities outside your access/)).toBeVisible();
  await shot('24-contact-salesperson-view-desktop-1440');

  await page.goto('/opportunities?view=table');
  await main.getByRole('button', { name: /^Municipal Service Portal$/ }).click();
  await main.getByRole('tab', { name: /Contacts/ }).click();
  await expect(main.getByText('Golam Mostafa')).toBeVisible();
  await shot('25-opportunity-contacts-tab-desktop-1440');

  await main.getByRole('tab', { name: /Activities/ }).click();
  await expect(main.getByRole('heading', { name: 'Activity log' })).toBeVisible();
  await shot('26-opportunity-activities-tab-desktop-1440');

  await main.getByRole('button', { name: 'Log Activity' }).first().click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Log activity' })).toBeVisible();
  await shot('27-log-activity-desktop-1440');
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();

  await page.goto('/activities?tab=log');
  await expect(main.getByRole('button', { name: 'Log Activity' })).toBeVisible();
  await expect(main.locator('ol li').first()).toBeVisible();
  await shot('28-activity-log-desktop-1440');
  await page.getByRole('button', { name: 'Sign out' }).click();

  // --- Section lead: the same contact, every link in the section ---------------
  await signIn(page, 'nadia.islam@example.com');
  await page.goto('/organizations?tab=contacts&q=Farzana');
  await main.getByRole('row').filter({ hasText: 'Farzana Yasmin' }).click();
  await expect(main.getByRole('button', { name: 'Edit', exact: true })).toBeVisible();
  await shot('29-contact-lead-view-desktop-1440');
});
