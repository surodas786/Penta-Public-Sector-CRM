/**
 * CR1 browser check: with email delivery on, an administrator adds a person;
 * the invitation is emailed (captured to a local folder, never sent), and the
 * person chooses a password from the link in that email and signs in.
 *
 * Two sign-ins. The capture folder is set in playwright.config.ts.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test, type Page } from '@playwright/test';

const PASSWORD = process.env.SEED_DEFAULT_PASSWORD ?? 'Synthetic-Dev-2026';
const MAILBOX = path.resolve('var/e2e-mailbox');
const PERSON = 'nusrat.jahan@example.com';
const CHOSEN = 'a passphrase from my invitation 2026';

test.describe.configure({ mode: 'serial' });

async function signIn(page: Page, email: string, password = PASSWORD) {
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/(dashboard|administration)$/);
}

/** The newest captured message to `to`, once the worker has sent it. */
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

test('an emailed invitation lets a new person choose a password and sign in', async ({ page }) => {
  const started = Date.now();
  await signIn(page, 'admin@example.com');

  // Turn email on (captured locally by this server).
  const delivery = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Email delivery', exact: true }) });
  await delivery.getByRole('button', { name: 'Edit settings' }).click();
  const settings = page.getByRole('dialog');
  await settings.getByLabel('Send email from the CRM').check();
  await settings.getByLabel(/Mail server/).fill('smtp.example.test');
  await settings.getByLabel(/^Port/).fill('587');
  await settings.getByLabel(/Sender address/).fill('crm@example.test');
  await settings.getByRole('button', { name: 'Save settings' }).click();
  await expect(settings).toBeHidden();

  // Adding a person emails the invitation; no link is shown.
  await page.getByRole('button', { name: 'Add user' }).click();
  const form = page.getByRole('dialog');
  await expect(form.getByText(/While email delivery is on, the person is emailed/)).toBeVisible();
  await form.getByLabel('Full name').fill('Nusrat Jahan');
  await form.getByLabel('Email').fill(PERSON);
  await form.getByLabel('Role').selectOption('management');
  await form.getByRole('button', { name: 'Add user' }).click();
  await expect(page.getByText('Invitation emailed')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Invitation link' })).toHaveCount(0);

  // The address also appears in the email delivery log; this is the user table row.
  const row = page.getByRole('row').filter({ hasText: PERSON }).filter({ hasText: 'Management' });
  await expect(row.getByText('Invitation pending')).toBeVisible();
  await expect(row.getByRole('button', { name: 'Email invitation' })).toBeVisible();
  await expect(row.getByRole('button', { name: 'Copy link' })).toBeVisible();
  await expect(async () => {
    await page.reload();
    await expect(row.getByText('Invitation emailed')).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await row.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'docs/evidence/cr/cr1-invitation-emailed.png' });
  await page.getByRole('button', { name: 'Sign out' }).click();

  // The person follows the link in the email.
  const message = await latestEmailTo(PERSON, started);
  expect(message.subject).toBe('Your Penta CRM account');
  const link = /(http\S+\/set-password#token=[\w-]+)/.exec(message.text)?.[1];
  expect(link).toBeTruthy();
  await page.goto(link!);
  await expect(page.getByRole('heading', { name: 'Choose your password' })).toBeVisible();
  await page.getByLabel(/^New password/).fill(CHOSEN);
  await page.getByLabel(/Repeat the password/).fill(CHOSEN);
  await page.getByRole('button', { name: 'Set password' }).click();
  await expect(page.getByRole('heading', { name: 'Password set' })).toBeVisible();

  await signIn(page, PERSON, CHOSEN);
  await expect(page.getByText('Nusrat Jahan')).toBeVisible();
});
