/**
 * CR1/CR3 account access, run in Chromium, Edge and Firefox
 * (`npm run test:browsers`):
 *
 *  - stale cookies left by an earlier deployment do not block sign-in
 *    (the stale-token recovery), and a fresh session works;
 *  - "Forgot your password?" emails a reset link, which opens a purpose-
 *    specific page, sets the password once, and ends the person's other
 *    session; opened again, it says it has been used;
 *  - changing the password refuses a wrong current password, then ends the
 *    other session.
 *
 * Email is captured to a private folder, never sent. Five sign-ins, under the
 * production login rate limit.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test, type Page } from '@playwright/test';

const PASSWORD = process.env.SEED_DEFAULT_PASSWORD ?? 'Synthetic-Dev-2026';
const MAILBOX = path.resolve('var/e2e-mailbox');
const PERSON = 'imran.hossain@example.com';
const RESET_PASSWORD = 'a password from a reset email 2026';
const CHANGED_PASSWORD = 'a password changed in the top bar 2026';

test.describe.configure({ mode: 'serial' });

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  // The landing page, or (CR2 step 6) the page that sent this browser to sign
  // in: Chromium and Edge keep that across a reload of /sign-in.
  await page.waitForURL(/\/(dashboard|administration|opportunities)$/);
}

async function latestEmailTo(to: string, since: number): Promise<{ subject: string; text: string }> {
  let found: { subject: string; text: string } | undefined;
  await expect(async () => {
    const messages = readdirSync(MAILBOX)
      .filter((file) => Number(file.split('-')[0]) >= since)
      .map((file) => JSON.parse(readFileSync(path.join(MAILBOX, file), 'utf8')) as { to: string; subject: string; text: string })
      .filter((message) => message.to === to);
    found = messages.at(-1);
    expect(found).toBeTruthy();
  }).toPass({ timeout: 30_000 });
  return found!;
}

/** The person's other session has ended: its next screen is sign-in. */
async function expectSignedOut(page: Page) {
  await page.goto('/opportunities');
  await expect(page).toHaveURL(/\/sign-in$/);
}

test('account access: stale cookies, forgot password, link states and session revocation', async ({ browser }, testInfo) => {
  // A long flow with two browser contexts; a cold Firefox start alone can take
  // much of the default minute.
  test.setTimeout(120_000);
  const evidence = testInfo.project.name === 'chromium';
  const started = Date.now();

  // A browser holding stale duplicate cookies from an earlier deployment, on
  // a longer path, so the browser sends them first.
  const context = await browser.newContext();
  await context.addCookies([
    { name: 'penta.sid', value: 's%3Astale-session.signature', domain: '127.0.0.1', path: '/api', httpOnly: true, sameSite: 'Strict' },
    { name: 'penta.csrf', value: 'stale-csrf-token', domain: '127.0.0.1', path: '/api', sameSite: 'Strict' },
  ]);
  const page = await context.newPage();
  await signIn(page, 'admin@example.com', PASSWORD);

  // Email on (captured locally), so the sign-in page offers recovery.
  const delivery = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Email delivery', exact: true }) });
  const settings = page.getByRole('dialog');
  // The panel can re-render as it finishes loading (seen in Firefox); click
  // again until the dialog is open, as a person would.
  await expect(async () => {
    await delivery.getByRole('button', { name: 'Edit settings' }).click();
    await expect(settings.getByLabel('Send email from the CRM')).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  await settings.getByLabel('Send email from the CRM').check();
  await settings.getByLabel(/Mail server/).fill('smtp.example.test');
  await settings.getByLabel(/^Port/).fill('587');
  await settings.getByLabel(/Sender address/).fill('crm@example.test');
  await settings.getByRole('button', { name: 'Save settings' }).click();
  await expect(settings).toBeHidden();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/sign-in$/);

  // The person is signed in elsewhere: a fresh session in its own context.
  const elsewhere = await (await browser.newContext()).newPage();
  await signIn(elsewhere, PERSON, PASSWORD);

  // Forgot your password?
  await page.getByRole('link', { name: 'Forgot your password?' }).click();
  await page.getByLabel('Email address').fill(PERSON);
  await page.getByRole('button', { name: 'Send me a link' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  await expect(page.getByText(/If an active account uses that address/)).toBeVisible();
  if (evidence) await page.screenshot({ path: 'docs/evidence/cr/cr3-forgot-password.png' });

  const message = await latestEmailTo(PERSON, started);
  expect(message.subject).toBe('Reset your Penta CRM password');
  const link = /(http\S+\/set-password#token=[\w-]+)/.exec(message.text)![1]!;

  // Opening the link does not spend it; saving the password does.
  await page.goto(link);
  await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();
  await expect(page).not.toHaveURL(/token=/);
  await page.getByLabel('New password').fill(RESET_PASSWORD);
  await page.getByLabel('Repeat the password').fill(RESET_PASSWORD);
  await page.getByRole('button', { name: 'Set password' }).click();
  await expect(page.getByRole('heading', { name: 'Password set' })).toBeVisible();
  await expectSignedOut(elsewhere);

  await page.goto(link);
  await expect(page.getByRole('heading', { name: 'This link has already been used' })).toBeVisible();
  if (evidence) await page.screenshot({ path: 'docs/evidence/cr/cr1-link-used.png' });

  // Change password from the top bar: a wrong current password is refused,
  // then the change ends the other session and keeps this one.
  await signIn(page, PERSON, RESET_PASSWORD);
  await signIn(elsewhere, PERSON, RESET_PASSWORD);
  await page.getByRole('button', { name: 'Change password' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Current password').fill('not my password at all');
  await dialog.getByLabel(/^New password/).fill(CHANGED_PASSWORD);
  await dialog.getByLabel('Repeat the new password').fill(CHANGED_PASSWORD);
  await dialog.getByRole('button', { name: 'Change password' }).click();
  await expect(dialog.getByText('Your current password is not correct.')).toBeVisible();
  await dialog.getByLabel('Current password').fill(RESET_PASSWORD);
  await dialog.getByRole('button', { name: 'Change password' }).click();
  await expect(page.getByText('Password changed. Your other sessions have been signed out.')).toBeVisible();
  await expectSignedOut(elsewhere);

  // This session continues and its protected requests still pass CSRF.
  await page.getByRole('link', { name: 'Opportunities' }).click();
  await expect(page).toHaveURL(/\/opportunities/);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await signIn(page, PERSON, CHANGED_PASSWORD);
});
