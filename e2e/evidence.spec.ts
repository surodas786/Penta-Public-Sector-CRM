/**
 * Captures screenshot evidence for the milestone report (plan 7.8, 8).
 *
 * Not part of the smoke gate — run explicitly with `npm run evidence`. Writes
 * to docs/evidence/, which is committed so a reviewer can see the implemented
 * screens without running anything.
 */
import path from 'node:path';
import { expect, test } from '@playwright/test';

const PASSWORD = process.env.SEED_DEFAULT_PASSWORD ?? 'Synthetic-Dev-2026';
const OUTPUT = path.resolve('docs', 'evidence');

const VIEWPORTS = [
  { label: 'desktop-1440', width: 1440, height: 900 },
  { label: 'tablet-768', width: 768, height: 1024 },
  { label: 'mobile-360', width: 360, height: 780 },
] as const;

async function signIn(page: import('@playwright/test').Page, email: string) {
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  // Wait for the session before navigating, or the sign-in request is cut off.
  await page.waitForURL(/\/(dashboard|administration)$/);
}

test.describe.configure({ mode: 'serial' });

test('capture implemented screens at each supported width', async ({ page }) => {
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });

    // Sign-in screen.
    await page.goto('/sign-in');
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await page.screenshot({ path: path.join(OUTPUT, `01-sign-in-${viewport.label}.png`), fullPage: true });

    // Salesperson: scoped opportunity list.
    await signIn(page, 'rafiq.hasan@example.com');
    await expect(page.getByRole('heading', { name: 'Opportunities' })).toBeVisible();
    // The M1 captures show the table; the board is captured in the M2 pass.
    await page.goto('/opportunities?view=table');
    // Wait for real rows: the skeleton would otherwise be what gets captured.
    await expect(
      page.locator('#main-content').getByRole('button', { name: /^Municipal Service Portal$/ }),
    ).toBeVisible();
    await page.screenshot({
      path: path.join(OUTPUT, `02-opportunities-salesperson-${viewport.label}.png`),
      fullPage: true,
    });

    // Opportunity detail.
    await page.locator('#main-content').getByRole('button', { name: /^Municipal Service Portal$/ }).click();
    await expect(page.getByRole('heading', { name: 'Municipal Service Portal' })).toBeVisible();
    await page.screenshot({
      path: path.join(OUTPUT, `03-opportunity-detail-${viewport.label}.png`),
      fullPage: true,
    });

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/sign-in$/);
  }

  // Back to desktop for the role-specific captures.
  await page.setViewportSize({ width: 1440, height: 900 });

  // Create dialog.
  await signIn(page, 'rafiq.hasan@example.com');
  await page.goto('/opportunities?view=table');
  await expect(
    page.locator('#main-content').getByRole('button', { name: /^Municipal Service Portal$/ }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Add Opportunity' }).click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Add opportunity' })).toBeVisible();
  await page.screenshot({ path: path.join(OUTPUT, '04-create-dialog-desktop-1440.png'), fullPage: true });
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'Sign out' }).click();

  // Section lead: whole section in scope.
  await signIn(page, 'nadia.islam@example.com');
  await page.goto('/opportunities?view=table');
  await expect(
    page.locator('#main-content').getByText(/every opportunity in your section/),
  ).toBeVisible();
  await expect(
    page.locator('#main-content').getByRole('button', { name: /^Public Training Institute ERP$/ }),
  ).toBeVisible();
  await page.screenshot({ path: path.join(OUTPUT, '05-opportunities-lead-desktop-1440.png'), fullPage: true });
  await page.getByRole('button', { name: 'Sign out' }).click();

  // Management: both sections.
  await signIn(page, 'arif.rahman@example.com');
  await page.goto('/opportunities?view=table');
  await expect(page.locator('#main-content').getByText('All sections')).toBeVisible();
  await expect(
    page.locator('#main-content').getByRole('button', { name: /^Government Data Center Upgrade$/ }),
  ).toBeVisible();
  await page.screenshot({ path: path.join(OUTPUT, '06-opportunities-management-desktop-1440.png'), fullPage: true });
  await page.getByRole('button', { name: 'Sign out' }).click();

  // Administrator: administration-only landing page, no commercial data.
  await signIn(page, 'admin@example.com');
  await expect(page).toHaveURL(/\/administration$/);
  await expect(page.getByRole('heading', { name: 'Administration' })).toBeVisible();
  await page.screenshot({ path: path.join(OUTPUT, '07-administration-desktop-1440.png'), fullPage: true });

  // Administrator following a commercial URL directly.
  await page.goto('/opportunities');
  await expect(page.getByRole('heading', { name: 'No access to commercial records' })).toBeVisible();
  await page.screenshot({ path: path.join(OUTPUT, '08-administrator-denied-desktop-1440.png'), fullPage: true });
});

test('capture Milestone 2 screens', async ({ page }) => {
  test.setTimeout(180_000);
  const main = page.locator('#main-content');
  const lane = (title: string) => page.getByRole('region', { name: `${title} column` });

  // Two sign-ins only: together with the M1 captures this stays under the
  // login rate limit (SEC-031), which is not relaxed for screenshots.
  await signIn(page, 'rafiq.hasan@example.com');

  // Pipeline board at each width (FR-015: narrow screens also have the table).
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/opportunities');
    await expect(lane('Requirements Discussion').getByText('Municipal Service Portal')).toBeVisible();
    await page.screenshot({ path: path.join(OUTPUT, `09-pipeline-salesperson-${viewport.label}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 900 });

  // Follow-ups list, then completing the last open task of a record.
  await page.goto('/activities');
  await expect(main.getByRole('group', { name: 'Follow-up filter' })).toBeVisible();
  await expect(main.getByRole('listitem').first()).toBeVisible();
  await page.screenshot({ path: path.join(OUTPUT, '10-follow-ups-desktop-1440.png'), fullPage: true });

  await page.goto('/opportunities');
  await lane('Requirements Discussion').getByRole('button').first().click();
  await main.getByRole('tab', { name: /Activities/ }).click();
  await main.getByRole('button', { name: 'Complete' }).first().click();
  await expect(page.getByRole('dialog').getByText('Next follow-up (required)')).toBeVisible();
  await page.screenshot({ path: path.join(OUTPUT, '11-complete-last-follow-up-desktop-1440.png'), fullPage: true });
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/sign-in$/);

  // Management: both sections, with the held and cancelled lanes.
  await signIn(page, 'arif.rahman@example.com');
  await page.goto('/opportunities');
  await expect(lane('On Hold').getByRole('listitem').first()).toBeVisible();
  await page.screenshot({ path: path.join(OUTPUT, '12-pipeline-management-desktop-1440.png'), fullPage: true });

  // Outcome dialog from the detail page's Change Stage menu.
  await lane('Tender Published').getByRole('button').first().click();
  await main.getByRole('combobox', { name: 'Change stage' }).selectOption('lost');
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Move to Lost' })).toBeVisible();
  await page.screenshot({ path: path.join(OUTPUT, '13-lost-dialog-desktop-1440.png'), fullPage: true });
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();

  // Reopening an Awarded record (management only).
  await page.goto('/opportunities');
  await lane('Awarded').getByRole('button').first().click();
  await main.getByRole('button', { name: 'Reopen' }).click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Reopen opportunity' })).toBeVisible();
  await page.screenshot({ path: path.join(OUTPUT, '14-reopen-dialog-desktop-1440.png'), fullPage: true });
});
