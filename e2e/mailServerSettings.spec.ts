/**
 * Settings → Mail Server: the administrator configures the mail server on its
 * own page. Values are saved in the database and survive a reload; the SMTP
 * password is write-only; the connection check and a test message use the
 * saved settings (captured, never sent). Other roles have no such page. The
 * page fits a 360 px screen.
 */
import { expect, test, type Page } from '@playwright/test';

const PASSWORD = process.env.SEED_DEFAULT_PASSWORD ?? 'Synthetic-Dev-2026';
const SMTP_PASSWORD = 'smtp-secret-typed-in-the-browser';

test.describe.configure({ mode: 'serial' });

async function signIn(page: Page, email: string) {
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/(dashboard|administration)$/);
}

test('the administrator sets up the mail server under Settings → Mail Server', async ({ page }) => {
  await signIn(page, 'admin@example.com');
  const navigation = page.getByRole('navigation', { name: 'Main navigation' });
  await expect(navigation.getByText('Settings', { exact: true })).toBeVisible();
  await navigation.getByRole('link', { name: 'Mail Server' }).click();
  await expect(page).toHaveURL(/\/settings\/mail-server$/);
  await expect(page.getByRole('heading', { name: 'Mail Server', level: 1 })).toBeVisible();
  await expect(page.getByText('None stored')).toBeVisible();
  // While delivery is off, the page says that a working test does not mean it is on.
  await expect(page.getByText(/A test message is still sent, so a successful test does not mean this is on\./)).toBeVisible();

  // Turning delivery on without a server is refused, next to the field.
  await page.getByLabel('Send email from the CRM').check();
  await page.getByLabel('Mail server (SMTP host)').fill('');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('Enter the mail server to turn delivery on.')).toBeVisible();

  await page.getByLabel('Mail server (SMTP host)').fill('smtp.example.test');
  await page.getByLabel('Port').fill('587');
  await page.getByLabel('Connection security').selectOption('starttls');
  await page.getByLabel('User name').fill('crm@example.test');
  await page.locator('#ms-password').fill(SMTP_PASSWORD);
  await page.getByLabel('Sender name').fill('Penta CRM');
  await page.getByLabel('Sender address').fill('crm@example.test');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('Mail server settings saved')).toBeVisible();

  // Saved in the database: a reload shows the values, never the password.
  await page.reload();
  await expect(page.getByLabel('Mail server (SMTP host)')).toHaveValue('smtp.example.test');
  await expect(page.getByLabel('Sender address')).toHaveValue('crm@example.test');
  await expect(page.locator('#ms-password')).toHaveValue('');
  await expect(page.getByText('Stored, encrypted')).toBeVisible();
  await expect(page.getByText(/ by Shahana Ferdous$/)).toBeVisible();
  expect(await page.content()).not.toContain(SMTP_PASSWORD);

  await page.getByRole('button', { name: 'Check connection' }).click();
  await expect(page.getByRole('status').getByText(/no mail server is contacted/)).toBeVisible();
  await page.getByRole('button', { name: 'Send test email' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Send to').fill('it.desk@example.test');
  await dialog.getByRole('button', { name: 'Send test' }).click();
  await expect(dialog.getByText('Test message to it.desk@example.test written to the local capture folder.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toHaveCount(0);
  await page.screenshot({ path: 'docs/evidence/cr/mail-server-settings-1440.png', fullPage: true });

  // A phone-sized screen: no page-level horizontal scroll.
  await page.setViewportSize({ width: 360, height: 780 });
  await page.reload();
  await expect(page.getByLabel('Mail server (SMTP host)')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.screenshot({ path: 'docs/evidence/cr/mail-server-settings-360.png' });
});

test('no other role reaches the mail server page', async ({ page }) => {
  await signIn(page, 'arif.rahman@example.com');
  await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Mail Server' })).toHaveCount(0);
  await page.goto('/settings/mail-server');
  await expect(page.getByRole('heading', { name: 'No access to account administration' })).toBeVisible();
  await expect(page.getByLabel('Mail server (SMTP host)')).toHaveCount(0);
});
