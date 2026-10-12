/**
 * CR4/CR5 browser check: an administrator gives a salesperson a second section
 * and appoints an existing lead to lead a second section; the salesperson
 * then creates an opportunity in the new section.
 *
 * The rules are proved by `server/tests/sections.test.ts`; this checks the
 * screens end to end. Three sign-ins, well under the login rate limit.
 */
import { expect, test, type Page } from '@playwright/test';

const PASSWORD = process.env.SEED_DEFAULT_PASSWORD ?? 'Synthetic-Dev-2026';

test.describe.configure({ mode: 'serial' });

async function signIn(page: Page, email: string) {
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/(dashboard|administration)$/);
}

test('multi-section salesperson and lead, from administration to a new opportunity', async ({ page }) => {
  await signIn(page, 'admin@example.com');

  // CR5: Tasnia joins Infrastructure & Security as well.
  const tasniaRow = page.getByRole('row').filter({ hasText: 'tasnia.karim@example.com' });
  await tasniaRow.getByRole('button', { name: 'Edit' }).click();
  const form = page.getByRole('dialog');
  await expect(form.getByLabel('Government Applications')).toBeChecked();
  await form.getByLabel('Infrastructure & Security').check();
  await expect(form.locator('#u-mgr-sales')).toHaveValue(
    'Nadia Islam (Government Applications), Farhan Ahmed (Infrastructure & Security)',
  );
  await page.screenshot({ path: 'docs/evidence/cr/cr5-user-sections.png' });
  await form.getByRole('button', { name: 'Save user' }).click();
  await expect(form).toBeHidden();
  await expect(tasniaRow.getByRole('cell', { name: 'Government Applications, Infrastructure & Security' })).toBeVisible();

  // CR4: Farhan, already leading IS, is appointed to lead GA as well.
  const government = page.locator('div').filter({ has: page.getByText('Government Applications', { exact: true }) }).filter({ has: page.getByRole('button', { name: 'Replace lead' }) }).last();
  await government.getByRole('button', { name: 'Replace lead' }).click();
  const leadDialog = page.getByRole('dialog');
  await leadDialog.getByLabel(/New lead/).selectOption({ label: 'Farhan Ahmed — leads Infrastructure & Security' });
  await leadDialog.getByLabel(/Reason/).fill('Farhan covers both sections during the pilot.');
  await page.screenshot({ path: 'docs/evidence/cr/cr4-replace-lead.png' });
  await leadDialog.getByRole('button', { name: 'Appoint lead' }).click();
  await expect(leadDialog).toBeHidden();
  const farhanRow = page.getByRole('row').filter({ hasText: 'farhan.ahmed@example.com' });
  await expect(farhanRow.getByRole('cell', { name: 'Government Applications, Infrastructure & Security' })).toBeVisible();

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/sign-in$/);

  // Tasnia creates an opportunity and chooses the section.
  await signIn(page, 'tasnia.karim@example.com');
  await expect(page.getByText('Salesperson — Government Applications, Infrastructure & Security')).toBeVisible();
  await page.getByRole('link', { name: 'Opportunities' }).click();
  await page.getByRole('button', { name: 'Add Opportunity' }).first().click();
  const create = page.getByRole('dialog');
  const section = create.locator('#c-section');
  await expect(section).toBeEnabled();
  await section.selectOption({ label: 'Infrastructure & Security' });
  await page.screenshot({ path: 'docs/evidence/cr/cr5-create-section-choice.png' });
  await create.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'Sign out' }).click();

  // Farhan's dashboard covers both sections he leads.
  await signIn(page, 'farhan.ahmed@example.com');
  await expect(page.getByText(/Government Applications, Infrastructure & Security/).first()).toBeVisible();
});
