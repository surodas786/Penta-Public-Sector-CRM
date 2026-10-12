/**
 * CR2 browser check: an administrator configures email, checks the
 * connection, sends a test message, and edits a template with a preview and
 * its saved versions; a salesperson changes their password and the "password
 * changed" email appears in the delivery log (captured, never sent).
 *
 * The server captures every message to a private folder (EMAIL_TRANSPORT=
 * capture in playwright.config.ts): nothing is sent. Three sign-ins.
 */
import { expect, test, type Page } from '@playwright/test';

const PASSWORD = process.env.SEED_DEFAULT_PASSWORD ?? 'Synthetic-Dev-2026';

test.describe.configure({ mode: 'serial' });

async function signIn(page: Page, email: string, password = PASSWORD) {
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/(dashboard|administration)$/);
}

test('an administrator sets up email and the password-changed email is delivered', async ({ page }) => {
  await signIn(page, 'admin@example.com');
  const delivery = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Email delivery', exact: true }) });
  await expect(delivery.getByText('No mail server saved yet.')).toBeVisible();
  await expect(delivery.getByText(/EMAIL_TRANSPORT=capture/)).toBeVisible();

  // Settings: required fields are explained next to their inputs.
  await delivery.getByRole('button', { name: 'Edit settings' }).click();
  const settings = page.getByRole('dialog');
  await settings.getByLabel('Send email from the CRM').check();
  await settings.getByRole('button', { name: 'Save settings' }).click();
  await expect(settings.getByText('Enter the mail server to turn delivery on.')).toBeVisible();

  await settings.getByLabel(/Mail server/).fill('smtp.example.test');
  await settings.getByLabel(/^Port/).fill('587');
  await settings.getByLabel('User name').fill('crm@example.test');
  await settings.getByLabel('Password', { exact: true }).fill('smtp-secret-for-the-browser-check');
  await settings.getByLabel('Sender name').fill('Penta CRM');
  await settings.getByLabel(/Sender address/).fill('crm@example.test');
  await page.screenshot({ path: 'docs/evidence/cr/cr2-email-settings.png' });
  await settings.getByRole('button', { name: 'Save settings' }).click();
  await expect(settings).toBeHidden();
  await expect(delivery.getByText('On', { exact: true })).toBeVisible();
  await expect(delivery.getByText(/smtp\.example\.test:587/)).toBeVisible();

  // The password is never shown again.
  await delivery.getByRole('button', { name: 'Edit settings' }).click();
  await expect(page.getByRole('dialog').getByLabel('Password', { exact: true })).toHaveValue('');
  await expect(page.getByRole('dialog').getByText('A password is stored. Leave empty to keep it.')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();

  // The connection check says plainly that capture mode contacts no server.
  await delivery.getByRole('button', { name: 'Check connection' }).click();
  await expect(delivery.getByRole('status').getByText(/no mail server is contacted/)).toBeVisible();

  // A test message is captured, and its result shown at once.
  await delivery.getByRole('button', { name: 'Send test email' }).click();
  const testDialog = page.getByRole('dialog');
  await testDialog.getByLabel(/Send to/).fill('it.desk@example.test');
  await testDialog.getByRole('button', { name: 'Send test' }).click();
  await expect(testDialog.getByText('Test message to it.desk@example.test written to the local capture folder.')).toBeVisible();
  await testDialog.getByRole('button', { name: 'Done' }).click();

  // Template wording, with a preview made of sample values.
  const templates = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Email templates' }) });
  await templates.getByRole('row').filter({ hasText: 'Password changed' }).getByRole('button', { name: 'Edit' }).click();
  const editor = page.getByRole('dialog');
  await editor.getByLabel(/^Message/).fill('Dear {{recipientName}}, your password changed on {{changedAt}}. {{nonsense}}');
  await editor.getByRole('button', { name: 'Save' }).click();
  await expect(editor.getByText(/Unknown placeholder \{\{nonsense\}\}/)).toBeVisible();
  await editor.getByLabel(/^Message/).fill('Dear {{recipientName}}, your password changed on {{changedAt}}. Contact your administrator if this was not you.');
  await editor.getByRole('button', { name: 'Preview' }).click();
  await expect(editor.getByLabel('Preview').getByText(/Dear Sample Person, your password changed on 15 Oct 2026/)).toBeVisible();
  await page.screenshot({ path: 'docs/evidence/cr/cr2-template-preview.png' });
  await editor.getByRole('button', { name: 'Save' }).click();
  await expect(editor).toBeHidden();
  await expect(templates.getByRole('row').filter({ hasText: 'Password changed' }).getByText(/edited/)).toBeVisible();

  // Its saved versions, newest first, from the audit.
  await templates.getByRole('row').filter({ hasText: 'Password changed' }).getByRole('button', { name: 'Edit' }).click();
  await editor.getByRole('button', { name: 'History' }).click();
  const versions = editor.getByLabel('Saved versions');
  await expect(versions.getByRole('listitem')).toHaveCount(1);
  await expect(versions.getByText(/changed message/)).toBeVisible();
  await page.screenshot({ path: 'docs/evidence/cr/cr2-template-history.png' });
  await editor.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'Sign out' }).click();

  // A salesperson changes their password: the email is queued and sent by the worker.
  await signIn(page, 'tasnia.karim@example.com');
  await page.getByRole('button', { name: 'Change password' }).click();
  const change = page.getByRole('dialog');
  await change.getByLabel('Current password').fill(PASSWORD);
  await change.getByLabel(/^New password/).fill('a changed passphrase for email 2026');
  await change.getByLabel('Repeat the new password').fill('a changed passphrase for email 2026');
  await change.getByRole('button', { name: 'Change password' }).click();
  await expect(page.getByText('Password changed. Your other sessions have been signed out.')).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();

  await signIn(page, 'admin@example.com');
  const log = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Email delivery log' }) });
  const row = log.getByRole('row').filter({ hasText: 'Password changed' });
  await expect(async () => {
    await page.reload();
    await expect(row.getByText('Captured, not sent', { exact: true })).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await expect(row.getByText('Tasnia Karim')).toBeVisible();
  await expect(log.getByRole('row').filter({ hasText: 'Test message' }).getByText('Captured, not sent', { exact: true })).toBeVisible();
  await row.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'docs/evidence/cr/cr2-delivery-log.png' });
});
