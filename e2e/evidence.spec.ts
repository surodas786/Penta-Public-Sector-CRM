/**
 * Captures screenshot evidence for the milestone report (plan 7.8, 8).
 *
 * Not part of the smoke gate — run explicitly with `npm run evidence`. Writes
 * to docs/evidence/, which is committed so a reviewer can see the implemented
 * screens without running anything.
 */
import path from 'node:path';
import { expect, test } from '@playwright/test';

const PASSWORD = process.env.SEED_DEFAULT_PASSWORD ?? 'Synthetic#Dev1';
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
