/**
 * Milestone 3 browser checks (AT-07, AT-09, SEC-030).
 *
 * The rules are proved by the backend suite; these check the screens honour
 * them end to end. Four sign-ins in total, so the whole browser run stays
 * under the login rate limit (SEC-031), which is not relaxed for tests.
 */
import { expect, test, type Page } from '@playwright/test';

const PASSWORD = process.env.SEED_DEFAULT_PASSWORD ?? 'Synthetic-Dev-2026';
const NEW_PASSWORD = 'a long and memorable passphrase 2026';
const TRAINING = 'Training Institute Learning Portal'; // Rafiq, Government Applications

test.describe.configure({ mode: 'serial' });

async function signIn(page: Page, email: string, password = PASSWORD) {
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/(opportunities|administration)$/);
}

test('an administrator invites a person, who sets a password and signs in', async ({ page }) => {
  await signIn(page, 'admin@example.com');
  await expect(page.getByRole('heading', { name: 'Administration' })).toBeVisible();

  // BR-051: an owner of open opportunities cannot be deactivated.
  const rafiqRow = page.getByRole('row').filter({ hasText: 'rafiq.hasan@example.com' });
  await rafiqRow.getByRole('button', { name: 'Deactivate' }).click();
  const confirm = page.getByRole('dialog');
  await confirm.getByRole('button', { name: 'Deactivate' }).click();
  await expect(confirm.getByText('Action blocked.')).toBeVisible();
  await expect(confirm.getByText(/owns opportunities that are still open/)).toBeVisible();
  await confirm.getByRole('button', { name: 'Cancel' }).click();

  // Add a salesperson: the reporting line is the section's lead.
  await page.getByRole('button', { name: 'Add user' }).click();
  const form = page.getByRole('dialog');
  await form.getByLabel('Full name').fill('Lamia Chowdhury');
  await form.getByLabel('Email').fill('lamia.chowdhury@example.com');
  await form.getByLabel('Role').selectOption('sales');
  await form.getByLabel('Section').selectOption({ label: 'Government Applications' });
  await expect(form.locator('#u-mgr-sales')).toHaveValue('Nadia Islam');
  await form.getByRole('button', { name: 'Add user' }).click();

  // The single-use link is shown once.
  const linkDialog = page.getByRole('dialog');
  await expect(linkDialog.getByRole('heading', { name: 'Invitation link' })).toBeVisible();
  const url = await linkDialog.getByLabel('Link').inputValue();
  expect(url).toMatch(/\/set-password#token=/);
  await linkDialog.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('row').filter({ hasText: 'lamia.chowdhury@example.com' }).getByText('Invitation pending')).toBeVisible();

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/sign-in$/);

  // The person opens the link, chooses a password and signs in.
  await page.goto(url);
  await expect(page.getByRole('heading', { name: 'Choose your password' })).toBeVisible();
  // The token is taken out of the address bar once read.
  await expect(page).toHaveURL(/\/set-password$/);
  await page.getByLabel('New password').fill(NEW_PASSWORD);
  await page.getByLabel('Repeat the password').fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Set password' }).click();
  await expect(page.getByRole('heading', { name: 'Password set' })).toBeVisible();

  await signIn(page, 'lamia.chowdhury@example.com', NEW_PASSWORD);
  await expect(page.getByText('Opportunities you own')).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();

  // The same link cannot be used twice.
  await page.goto(url);
  await page.getByLabel('New password').fill('yet another long passphrase');
  await page.getByLabel('Repeat the password').fill('yet another long passphrase');
  await page.getByRole('button', { name: 'Set password' }).click();
  await expect(page.getByText(/invalid, has already been used, or has expired/)).toBeVisible();
});

test('a section lead reassigns a record and the previous owner loses it', async ({ page }) => {
  await signIn(page, 'nadia.islam@example.com');
  await page.goto('/opportunities?view=table');
  const main = page.locator('#main-content');
  await main.getByRole('button', { name: new RegExp(`^${TRAINING}$`) }).click();
  await expect(main.getByRole('heading', { name: TRAINING })).toBeVisible();
  const recordUrl = page.url();

  await main.getByRole('button', { name: 'Reassign', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Reassign opportunity' })).toBeVisible();
  // A lead is offered only their own section.
  await expect(dialog.locator('optgroup')).toHaveCount(1);
  await dialog.getByLabel('New owner').selectOption({ label: 'Tasnia Karim' });
  await dialog.getByRole('button', { name: 'Continue' }).click();

  await expect(dialog.getByRole('heading', { name: 'Confirm reassignment' })).toBeVisible();
  await dialog.getByLabel('Reason').fill('Rafiq moves to the ERP bid team.');
  await dialog.getByRole('button', { name: 'Reassign to Tasnia Karim' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(main.getByText('Owner').locator('..').getByText('Tasnia Karim')).toBeVisible();

  await main.getByRole('tab', { name: /Change History/ }).click();
  await expect(main.getByText('Ownership transferred').first()).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();

  // Rafiq follows his old link: the server answers 404.
  await signIn(page, 'rafiq.hasan@example.com');
  await page.goto(recordUrl);
  await expect(page.getByRole('heading', { name: 'Not available' })).toBeVisible();
  await expect(main.getByText(TRAINING)).toHaveCount(0);
});
