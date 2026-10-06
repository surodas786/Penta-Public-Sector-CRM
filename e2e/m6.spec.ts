/**
 * Milestone 6 browser checks (FR-080–FR-083, FR-090, FR-091). Runs as its own
 * Playwright run on freshly seeded fixtures, with the API's job worker on and
 * the real clock. Four sign-ins, under the login rate limit.
 *
 * The scope and calculation rules are proved by the backend suite; this
 * checks that the approved screens drive the real endpoints end to end, that
 * a card's number is the number its list shows, and that each role sees only
 * what it should.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test, type Page } from '@playwright/test';

const PASSWORD = process.env.SEED_DEFAULT_PASSWORD ?? 'Synthetic-Dev-2026';

test.describe.configure({ mode: 'serial' });

async function signIn(page: Page, email: string, landing: RegExp = /\/dashboard$/) {
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(landing);
}

async function shot(page: Page, name: string) {
  const directory = process.env.REVIEW_SHOTS;
  if (directory) await page.screenshot({ path: path.join(directory, `${name}.png`), fullPage: true });
}

/** The figure on a KPI card, by its label. */
async function kpi(page: Page, label: string): Promise<string> {
  const card = page.locator('#main-content button', { hasText: label }).first();
  await expect(card).toBeVisible();
  const text = (await card.innerText()).split('\n').map((line) => line.trim());
  return text[text.indexOf(label.toUpperCase()) + 1] ?? text[1] ?? '';
}

test('management: dashboard drills into matching lists, reports and an audited CSV export', async ({ page }) => {
  await signIn(page, 'arif.rahman@example.com');
  const main = page.locator('#main-content');
  await expect(main.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(main.getByText('Organization-wide pipeline across all sections')).toBeVisible();
  await expect(main.getByText('Estimate — excludes On Hold / Cancelled / Awarded / Lost')).toBeVisible();
  await expect(main.getByRole('heading', { name: 'Pipeline Value by Section' })).toBeVisible();
  await expect(main.getByRole('heading', { name: 'Team Workload' })).toBeVisible();
  await shot(page, 'm6-management-dashboard');

  // The Active Opportunities card opens the same population in the table.
  const active = await kpi(page, 'Active Opportunities');
  await main.locator('button', { hasText: 'Active Opportunities' }).first().click();
  await expect(page).toHaveURL(/\/opportunities\?view=table&pipeline=active/);
  await expect(main.getByText('Active pipeline: Active status, not Awarded or Lost')).toBeVisible();
  await expect(main.getByText(`${active} accessible opportunities`)).toBeVisible();

  // Section filter: management only.
  await page.goto('/dashboard');
  await main.getByLabel('Section').selectOption({ label: 'Infrastructure & Security' });
  await expect(page).toHaveURL(/section=/);
  // The scope note on the card names the section the figures now cover.
  await expect(main.locator('button', { hasText: 'Active Opportunities' }).first()).toContainText('Infrastructure & Security');

  // Reports: the date basis is named, rows come from the server, CSV covers all rows.
  await page.getByRole('link', { name: 'Reports', exact: true }).click();
  await expect(main.getByRole('heading', { name: 'Pipeline by stage' })).toBeVisible();
  await expect(main.getByText('Opportunity created date', { exact: true })).toBeVisible();
  await main.getByRole('button', { name: 'Awarded and lost opportunities' }).click();
  await expect(main.getByText('Award date (Awarded) or lost date (Lost)', { exact: true })).toBeVisible();
  await expect(main.getByRole('cell', { name: 'Riverbank e-Services Portal' })).toBeVisible();
  await shot(page, 'm6-management-report-outcomes');

  const downloadPromise = page.waitForEvent('download');
  await main.getByRole('button', { name: 'Export CSV' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^penta-outcomes-\d{4}-\d{2}-\d{2}\.csv$/);
  const file = await download.path();
  const csv = readFileSync(file, 'utf8');
  expect(csv.charCodeAt(0)).toBe(0xfeff);
  expect(csv).toContain('Estimated (BDT),Actual awarded (BDT)');
  expect(csv).toContain('26000000.00,23500000.00');
  await expect(page.getByText('CSV exported')).toBeVisible();
});

test('lead: section-only dashboard, workload drill-down and scoped search', async ({ page }) => {
  await signIn(page, 'nadia.islam@example.com');
  const main = page.locator('#main-content');
  await expect(main.getByText('Government Applications section')).toBeVisible();
  await expect(main.getByLabel('Section')).toHaveCount(0);
  await expect(main.getByRole('heading', { name: 'Pipeline Value by Section' })).toHaveCount(0);
  const workload = main.getByRole('table').first();
  await expect(workload.getByText('Rafiq Hasan')).toBeVisible();
  await expect(workload.getByText('Imran Hossain')).toHaveCount(0);
  await shot(page, 'm6-lead-dashboard');

  // Scoped search: own section found, other section never suggested.
  const search = page.getByPlaceholder('Search opportunities, tenders, contacts…');
  await search.fill('Municipal Service');
  await expect(page.getByRole('listbox', { name: 'Search results' }).getByText('Municipal Service Portal')).toBeVisible();
  await search.fill('Government Data Center');
  await expect(page.getByRole('listbox', { name: 'Search results' })).toContainText('No accessible records match');
  await search.fill('a');
  await expect(page.getByRole('listbox', { name: 'Search results' })).toContainText('Type at least 2 characters');
  await search.fill('');

  // The overdue card opens exactly its follow-ups.
  const overdue = await kpi(page, 'Overdue Follow-ups');
  await main.locator('button', { hasText: 'Overdue Follow-ups' }).first().click();
  await expect(page).toHaveURL(/\/activities\?filter=overdue&hold=exclude/);
  await expect(main.getByText('Not On Hold records')).toBeVisible();
  await expect(main.getByRole('button', { name: /^Overdue/ })).toContainText(overdue);
});

test('salesperson: own figures, notifications read without completing the task', async ({ page }) => {
  await signIn(page, 'rafiq.hasan@example.com');
  const main = page.locator('#main-content');
  await expect(main.getByText('Your opportunities, follow-ups and tenders')).toBeVisible();
  await expect(main.getByLabel('Owner')).toHaveCount(0);
  await expect(main.getByRole('heading', { name: 'My Next Actions' })).toBeVisible();

  // The job worker generated alerts at start-up; the bell shows the server's count.
  const bell = page.getByRole('button', { name: /^Notifications/ });
  await expect(async () => {
    await page.reload();
    await expect(bell).toHaveAccessibleName(/unread/, { timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  const before = Number((await bell.getAttribute('aria-label'))?.match(/(\d+) unread/)?.[1] ?? '0');
  expect(before).toBeGreaterThan(0);

  await bell.click();
  const menu = page.getByRole('dialog', { name: 'Notifications' });
  await expect(menu.getByText('Reading an alert does not complete its task.')).toBeVisible();
  await shot(page, 'm6-salesperson-notifications');
  const overdueAlert = menu.getByRole('button', { name: /^Overdue: / }).first();
  const title = (await overdueAlert.innerText()).split('\n')[0]!.replace(/^Overdue: /, '').replace(' (unread)', '');
  await overdueAlert.click();
  await expect(page).toHaveURL(/\/opportunities\/[0-9a-f-]{36}\?tab=activities/);
  await expect(bell).toHaveAccessibleName(before - 1 > 0 ? `Notifications, ${before - 1} unread` : 'Notifications');

  // The task is still open: reading did not complete it.
  await expect(main.getByText(title).first()).toBeVisible();
  await expect(main.getByRole('button', { name: 'Complete' }).first()).toBeVisible();

  // Search never shows another salesperson's record.
  const search = page.getByPlaceholder('Search opportunities, tenders, contacts…');
  await search.fill('Public Training Institute ERP');
  await expect(page.getByRole('listbox', { name: 'Search results' })).toContainText('No accessible records match');

  // Salespeople get no other-user selector on reports either.
  await page.goto('/reports?report=overdue_follow_ups');
  await expect(main.getByText('Follow-up due date', { exact: true })).toBeVisible();
  await expect(main.getByLabel('Owner')).toHaveCount(0);
  await expect(main.getByLabel('Section')).toHaveCount(0);
});

test('administrator: no commercial dashboard, report, search result or notification', async ({ page }) => {
  await signIn(page, 'admin@example.com', /\/administration$/);
  await expect(page.getByRole('link', { name: 'Dashboard' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Reports' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Notifications/ })).toHaveCount(0);

  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'No access to commercial records' })).toBeVisible();
  await page.goto('/reports');
  await expect(page.getByRole('heading', { name: 'No access to commercial records' })).toBeVisible();

  const search = page.getByPlaceholder('Search accounts and sections…');
  await search.fill('Municipal Service');
  await expect(page.getByRole('listbox', { name: 'Search results' })).toContainText('No accessible records match');
  await search.fill('Rafiq');
  await page.getByRole('listbox', { name: 'Search results' }).getByText('Rafiq Hasan').click();
  await expect(page).toHaveURL(/\/administration\?q=Rafiq/);
  await shot(page, 'm6-admin-search');
});
