/**
 * Change requests CR1–CR6: responsive and keyboard checks for the screens
 * they changed, the way the Milestone 8 checks cover the release-one screens.
 *
 *   - responsive: Software Procurement (area and opportunity tab), the
 *     multi-section administration, email administration with notification
 *     timing, and the change-password dialog, at 1440, 768 and 360 px, with
 *     no page-level horizontal scroll;
 *   - keyboard: the change-password dialog, the notification-timing dialog
 *     and the procurement dialog open from the keyboard, take focus, and
 *     close with Escape.
 *
 * Runs on freshly seeded fixtures; nothing is saved. Screenshots go to
 * docs/evidence/cr/interface-<screen>-<width>.png (Chromium only).
 */
import { mkdirSync } from 'node:fs';

import { expect, test, type Locator, type Page } from '@playwright/test';

const PASSWORD = process.env.SEED_DEFAULT_PASSWORD ?? 'Synthetic-Dev-2026';
const EVIDENCE = 'docs/evidence/cr';

test.describe.configure({ mode: 'serial' });

async function signIn(page: Page, email: string) {
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/(dashboard|administration)$/);
}

async function expectNoPageOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${label}: page wider than the viewport by ${overflow}px`).toBeLessThanOrEqual(1);
}

/** Opens a dialog from the keyboard, checks focus moved inside, and closes it with Escape. */
async function keyboardDialog(page: Page, trigger: Locator, label: string) {
  await trigger.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog, label).toBeVisible();
  await expect.poll(() => dialog.evaluate((element) => element.contains(document.activeElement)), { message: `${label}: focus inside` }).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog, label).toHaveCount(0);
}

const WIDTHS = [1440, 768, 360];

test('a salesperson’s changed screens fit every width and work from the keyboard', async ({ page }, testInfo) => {
  mkdirSync(EVIDENCE, { recursive: true });
  const capture = testInfo.project.name === 'chromium';
  await signIn(page, 'rafiq.hasan@example.com');
  await page.goto('/opportunities?view=table');
  await page.locator('#main-content').getByRole('button', { name: /^Municipal Service Portal$/ }).click();
  await expect(page.getByRole('heading', { name: 'Municipal Service Portal' })).toBeVisible();
  const procurementTab = `${new URL(page.url()).pathname}?tab=procurement`;

  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: width === 360 ? 780 : 900 });
    for (const screen of [
      { name: 'procurement-area', url: '/procurement', ready: () => page.locator('#main-content h1').first() },
      { name: 'procurement-tab', url: procurementTab, ready: () => page.getByRole('button', { name: 'Add procurement' }) },
    ]) {
      await page.goto(screen.url);
      await expect(screen.ready()).toBeVisible();
      await expectNoPageOverflow(page, `${screen.name} at ${width}px`);
      if (capture) await page.screenshot({ path: `${EVIDENCE}/interface-${screen.name}-${width}.png` });
    }
    // The change-password dialog fits too.
    const changePassword = page.getByRole('button', { name: 'Change password' });
    if (await changePassword.isVisible()) {
      await changePassword.click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await expectNoPageOverflow(page, `change-password at ${width}px`);
      if (capture) await page.screenshot({ path: `${EVIDENCE}/interface-change-password-${width}.png` });
      await page.keyboard.press('Escape');
    }
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(procurementTab);
  await keyboardDialog(page, page.getByRole('button', { name: 'Add procurement' }), 'add procurement');
  await keyboardDialog(page, page.getByRole('button', { name: 'Change password' }), 'change password');
});

test('the administrator’s changed screens fit every width and work from the keyboard', async ({ page }, testInfo) => {
  const capture = testInfo.project.name === 'chromium';
  await signIn(page, 'admin@example.com');
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: width === 360 ? 780 : 900 });
    await page.goto('/administration');
    for (const heading of ['User accounts', 'Sections and reporting lines', 'Email delivery', 'Email templates', 'Notification timing']) {
      const section = page.getByRole('heading', { name: heading, exact: true }).first();
      await section.scrollIntoViewIfNeeded();
      await expect(section).toBeVisible();
    }
    await expectNoPageOverflow(page, `administration at ${width}px`);
    if (capture) {
      await page.getByRole('heading', { name: 'Notification timing' }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${EVIDENCE}/interface-administration-${width}.png` });
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/administration');
  await keyboardDialog(page, page.getByRole('button', { name: 'Edit timing' }), 'notification timing');
  await keyboardDialog(page, page.getByRole('button', { name: 'Change password' }), 'change password (administrator)');
});
