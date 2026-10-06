/**
 * Milestone 8 interface checks (FR-013, FR-015, NFR-012, BR-091 in the browser).
 *
 * Runs once per browser (`npm run test:browsers`: Chromium, Microsoft Edge,
 * Firefox), each as its own Playwright run on freshly seeded fixtures. Five
 * sign-ins per run, under the production login rate limit.
 *
 *   - responsive: the main screens at 1440, 768 and 360 px have no page-level
 *     horizontal scroll, and the navigation stays reachable;
 *   - keyboard: sign in without a mouse; focus is visible; a dialog takes
 *     focus and closes with Escape;
 *   - readable errors: a failed sign-in and a server-side field error read
 *     as text next to their cause;
 *   - Bangla text and BDT formatting round-trip;
 *   - network failure never shows an unsaved action as saved, and a retry
 *     after an uncertain failure (applied on the server, response lost)
 *     reuses its idempotency key: one record, not two.
 *
 * Screenshots go to docs/evidence/m8/<browser>-<screen>-<width>.png.
 */
import { mkdirSync } from 'node:fs';

import { expect, test, type Page } from '@playwright/test';

const PASSWORD = process.env.SEED_DEFAULT_PASSWORD ?? 'Synthetic-Dev-2026';
const RAFIQ = 'rafiq.hasan@example.com';
const EVIDENCE = 'docs/evidence/m8';

test.describe.configure({ mode: 'serial' });

async function signIn(page: Page, email = RAFIQ) {
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/dashboard$/);
}

async function openPortal(page: Page) {
  await page.goto('/opportunities?view=table');
  await page.locator('#main-content').getByRole('button', { name: /^Municipal Service Portal$/ }).click();
  await expect(page.getByRole('heading', { name: 'Municipal Service Portal' })).toBeVisible();
  return page.url();
}

async function expectNoPageOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${label}: page wider than the viewport by ${overflow}px`).toBeLessThanOrEqual(1);
}

test('responsive layouts at 1440, 768 and 360 px', async ({ page, browserName }, testInfo) => {
  const browser = testInfo.project.name;
  mkdirSync(EVIDENCE, { recursive: true });
  await signIn(page);
  const detailUrl = await openPortal(page);
  const screens = [
    { name: 'dashboard', url: '/dashboard', ready: () => page.getByText('Active Opportunities').first() },
    { name: 'opportunities', url: '/opportunities?view=table', ready: () => page.locator('#main-content table tbody tr').first() },
    { name: 'opportunity-detail', url: detailUrl, ready: () => page.getByRole('heading', { name: 'Municipal Service Portal' }) },
    { name: 'activities-follow-ups', url: '/activities', ready: () => page.locator('#main-content h1').first() },
    { name: 'tender-tracker', url: '/tenders', ready: () => page.locator('#main-content h1').first() },
  ];
  // Evidence screenshots: every screen in Chromium; two per width elsewhere.
  const capture = (screen: string) => browserName === 'chromium' || screen === 'dashboard' || screen === 'opportunity-detail';

  for (const width of [1440, 768, 360]) {
    await page.setViewportSize({ width, height: width === 360 ? 780 : 900 });
    for (const screen of screens) {
      await page.goto(screen.url);
      await expect(screen.ready()).toBeVisible();
      await expectNoPageOverflow(page, `${screen.name} at ${width}px`);
      if (capture(screen.name)) {
        await page.screenshot({ path: `${EVIDENCE}/${browser}-${screen.name}-${width}.png`, fullPage: false });
      }
    }
    // The navigation stays reachable: inline on wide screens, behind a button on narrow ones.
    const navigation = page.getByRole('navigation', { name: 'Main navigation' });
    if (!(await navigation.getByRole('link', { name: 'Opportunities' }).isVisible())) {
      await page.getByRole('button', { name: 'Open navigation' }).click();
    }
    await expect(navigation.getByRole('link', { name: 'Opportunities' })).toBeVisible();
  }
});

test('keyboard: sign in, visible focus, and a dialog that takes focus and closes with Escape', async ({ page }) => {
  await page.goto('/sign-in');
  const email = page.getByLabel('Email address');
  await email.focus();
  await page.keyboard.type(RAFIQ);
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Password')).toBeFocused();
  await page.keyboard.type(PASSWORD);
  await page.keyboard.press('Tab');
  // Focus is shown: an outline or a focus ring (box-shadow).
  const focusStyle = await page.evaluate(() => {
    const element = document.activeElement as HTMLElement;
    const style = getComputedStyle(element);
    return { tag: element.tagName, outline: style.outlineStyle, outlineWidth: style.outlineWidth, shadow: style.boxShadow };
  });
  expect(focusStyle.outline !== 'none' && focusStyle.outlineWidth !== '0px' || focusStyle.shadow !== 'none', JSON.stringify(focusStyle)).toBe(true);
  await page.getByLabel('Password').press('Enter');
  await page.waitForURL(/\/dashboard$/);

  await openPortal(page);
  await page.getByRole('tab', { name: /Activities/ }).click();
  const trigger = page.getByRole('button', { name: 'Log Activity' }).first();
  await trigger.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const focusInside = await dialog.evaluate((element) => element.contains(document.activeElement));
  expect(focusInside).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('readable errors, Bangla text and BDT formatting', async ({ page }) => {
  // A failed sign-in: one plain message, nothing about which part was wrong.
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(RAFIQ);
  await page.getByLabel('Password').fill('not-the-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toHaveText('Email address or password is incorrect.');

  await signIn(page);
  await openPortal(page);
  // BDT in full, with Indian digit grouping (42,000,000.00 → ৳ 4,20,00,000.00).
  await expect(page.getByText('৳ 4,20,00,000.00').first()).toBeVisible();

  await page.getByRole('tab', { name: /Activities/ }).click();
  await page.getByRole('button', { name: 'Log Activity' }).first().click();
  const dialog = page.getByRole('dialog');
  // A subject of spaces passes the browser's own check but not the server's:
  // the 422 field error appears beside the field, and nothing is saved.
  await dialog.getByLabel('Subject').fill('   ');
  await dialog.getByRole('button', { name: 'Log activity' }).click();
  await expect(dialog.getByText('Enter a subject.')).toBeVisible();

  const subject = 'প্রকল্প পরিচালকের সাথে বৈঠক';
  await dialog.getByLabel('Subject').fill(subject);
  await dialog.getByLabel('Notes').fill('বাজেট অনুমোদন পরের সপ্তাহে।');
  await dialog.getByRole('button', { name: 'Log activity' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('#main-content').getByText(subject)).toBeVisible();
});

test('a network failure never shows an unsaved action as saved; a retry is applied once', async ({ page, context }) => {
  await signIn(page);
  const detailUrl = await openPortal(page);
  const opportunityId = new URL(detailUrl).pathname.split('/').pop() as string;
  await page.getByRole('tab', { name: /Activities/ }).click();

  // 1. Hard failure: the request never reaches the server.
  await page.route('**/api/opportunities/*/activities', (route) =>
    route.request().method() === 'POST' ? route.abort('internetdisconnected') : route.continue(),
  );
  await page.getByRole('button', { name: 'Log Activity' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Subject').fill('Call that must not be lost');
  await dialog.getByRole('button', { name: 'Log activity' }).click();
  await expect(dialog.getByText(/could not be reached/)).toBeVisible();
  await expect(page.locator('[data-sonner-toast][data-type="success"]')).toHaveCount(0);
  await expect(dialog.getByLabel('Subject')).toHaveValue('Call that must not be lost');
  await page.unroute('**/api/opportunities/*/activities');
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  // 2. Uncertain failure: the server applies it, the response is lost.
  const keys: string[] = [];
  await page.route('**/api/opportunities/*/activities', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    keys.push((await route.request().allHeaders())['idempotency-key'] ?? '');
    await route.fetch();
    await route.abort('connectionreset');
  });
  await page.getByRole('button', { name: 'Log Activity' }).first().click();
  await dialog.getByLabel('Subject').fill('Applied but unconfirmed');
  await dialog.getByRole('button', { name: 'Log activity' }).click();
  await expect(dialog.getByText(/could not be reached/)).toBeVisible();
  await expect(page.locator('[data-sonner-toast][data-type="success"]')).toHaveCount(0);

  // The person retries: same key, so the server replays instead of adding a second.
  await page.unroute('**/api/opportunities/*/activities');
  const retried = page.waitForRequest((request) => request.method() === 'POST' && request.url().includes('/activities'));
  await dialog.getByRole('button', { name: 'Log activity' }).click();
  const retry = await retried;
  expect(retry.headers()['idempotency-key']).toBe(keys[0]);
  await expect(dialog).toHaveCount(0);
  const list = await page.request.get(`/api/opportunities/${opportunityId}/activities?pageSize=100`);
  const items = ((await list.json()) as { items: { subject: string }[] }).items;
  expect(items.filter((item) => item.subject === 'Applied but unconfirmed')).toHaveLength(1);

  // 3. Offline while saving an edit: an error, never a confirmation. The
  // genuine confirmation from step 2 is allowed to clear first.
  const successToasts = page.locator('[data-sonner-toast][data-type="success"]');
  for (const close of await page.getByRole('button', { name: 'Close toast' }).all()) await close.click();
  await expect(successToasts).toHaveCount(0);
  await page.getByRole('tab', { name: /Overview/ }).click();
  await page.getByRole('button', { name: /^Edit/ }).first().click();
  const edit = page.getByRole('dialog');
  await edit.getByLabel('Description').fill('Edited while offline');
  await context.setOffline(true);
  await edit.getByRole('button', { name: /Save/ }).click();
  await expect(edit.getByText(/could not be reached/)).toBeVisible();
  // No success confirmation of any kind (sonner marks toasts by type).
  await expect(page.locator('[data-sonner-toast][data-type="success"]')).toHaveCount(0);
  await context.setOffline(false);
});

test('Back to Opportunities returns to the same filtered list (FR-013)', async ({ page }) => {
  await signIn(page);
  await page.goto('/opportunities?view=table&stage=requirements_discussion&priority=high');
  await page.locator('#main-content').getByRole('button', { name: /^Municipal Service Portal$/ }).click();
  await expect(page.getByRole('heading', { name: 'Municipal Service Portal' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to Opportunities' }).click();
  await expect(page).toHaveURL(/\/opportunities\?/);
  const url = new URL(page.url());
  expect(url.searchParams.get('stage')).toBe('requirements_discussion');
  expect(url.searchParams.get('priority')).toBe('high');
  expect(url.searchParams.get('view')).toBe('table');
});
