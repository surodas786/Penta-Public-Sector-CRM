/**
 * Milestone 6 screenshot evidence. Run by `npm run evidence` as its own
 * Playwright run on fresh fixtures, with the API's job worker on and the real
 * clock. Three sign-ins. Every record is synthetic.
 */
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const PASSWORD = process.env.SEED_DEFAULT_PASSWORD ?? 'Synthetic-Dev-2026';
const OUTPUT = path.resolve('docs', 'evidence');

async function signIn(page: Page, email: string, landing = /\/dashboard$/) {
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(landing);
}

test('capture Milestone 6 screens', async ({ page }) => {
  test.setTimeout(180_000);
  const main = page.locator('#main-content');
  const shot = (name: string) => page.screenshot({ path: path.join(OUTPUT, `${name}.png`), fullPage: true });

  // --- Management: dashboard at the three supported widths ------------------
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, 'arif.rahman@example.com');
  await expect(main.getByRole('heading', { name: 'Team Workload' })).toBeVisible();
  await shot('37-dashboard-management-desktop-1440');
  for (const [width, height, label] of [
    [768, 1024, 'tablet-768'],
    [360, 780, 'mobile-360'],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.reload();
    await expect(main.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await expect(main.getByText('Estimated Active Pipeline Value')).toBeVisible();
    await shot(`38-dashboard-management-${label}`);
  }
  await page.setViewportSize({ width: 1440, height: 900 });

  // A card's drill-down: the same population, named.
  await page.goto('/dashboard');
  await main.locator('button', { hasText: 'Active Opportunities' }).first().click();
  await expect(main.getByText('Active pipeline: Active status, not Awarded or Lost')).toBeVisible();
  await shot('39-dashboard-drill-down-active-pipeline-desktop-1440');

  await page.goto('/reports');
  await expect(main.getByText('Opportunity created date', { exact: true })).toBeVisible();
  await shot('40-report-pipeline-by-stage-desktop-1440');
  await page.goto('/reports?report=outcomes&from=2026-07-01&to=2026-12-31');
  await expect(main.getByText('Award date (Awarded) or lost date (Lost)', { exact: true })).toBeVisible();
  await shot('41-report-outcomes-dated-desktop-1440');
  const download = page.waitForEvent('download');
  await main.getByRole('button', { name: 'Export CSV' }).click();
  await download;
  await expect(page.getByText('CSV exported')).toBeVisible();
  await shot('42-report-export-done-desktop-1440');
  await page.getByRole('button', { name: 'Sign out' }).click();

  // --- Section lead: section view, search, notifications ----------------------
  await signIn(page, 'nadia.islam@example.com');
  await expect(main.getByRole('heading', { name: 'Team Workload' })).toBeVisible();
  await shot('43-dashboard-lead-desktop-1440');
  await page.getByPlaceholder('Search opportunities, tenders, contacts…').fill('Portal');
  await expect(page.getByRole('listbox', { name: 'Search results' }).getByText('Opportunities')).toBeVisible();
  await shot('44-scoped-search-lead-desktop-1440');
  await page.keyboard.press('Escape');
  const bell = page.getByRole('button', { name: /^Notifications/ });
  await expect(async () => {
    await page.reload();
    await expect(bell).toHaveAccessibleName(/unread/, { timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await bell.click();
  await expect(page.getByRole('dialog', { name: 'Notifications' })).toBeVisible();
  await shot('45-notifications-lead-desktop-1440');
  await page.keyboard.press('Escape');
  await page.goto('/activities?filter=overdue&hold=exclude');
  await expect(main.getByText('Not On Hold records')).toBeVisible();
  await shot('46-overdue-drill-down-desktop-1440');
  await page.getByRole('button', { name: 'Sign out' }).click();

  // --- Administrator: accounts and sections only ------------------------------
  await signIn(page, 'admin@example.com', /\/administration$/);
  await page.getByPlaceholder('Search accounts and sections…').fill('Infra');
  await expect(page.getByRole('listbox', { name: 'Search results' }).getByText('Infrastructure & Security')).toBeVisible();
  await shot('47-admin-search-accounts-sections-desktop-1440');
});
