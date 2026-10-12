/**
 * CR6 browser check: a salesperson creates a Software Procurement
 * opportunity, records the EOI, marks it submitted (offered EOI Submitted),
 * records it Shortlisted, adds the RFP, and finds the record on the
 * Software Procurement board. One sign-in.
 */
import { expect, test } from '@playwright/test';

const PASSWORD = process.env.SEED_DEFAULT_PASSWORD ?? 'Synthetic-Dev-2026';
const NAME = 'Integrated Financial Management Software';

test('a Software Procurement opportunity goes from EOI to RFP', async ({ page }) => {
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill('rafiq.hasan@example.com');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/dashboard$/);
  await page.getByRole('link', { name: 'Opportunities', exact: true }).click();

  // Create: the workflow decides the stage list.
  await page.getByRole('button', { name: 'Add Opportunity' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Project / opportunity name').fill(NAME);
  await dialog.getByLabel('Procuring organization').selectOption({ index: 1 });
  await dialog.getByLabel('Solution category').selectOption('custom_software');
  await dialog.getByLabel('Estimated value (BDT)').fill('45000000');
  await dialog.getByLabel(/^Workflow/).selectOption('software_procurement');
  const stageOptions = await dialog.getByLabel(/Current stage/).locator('option').allTextContents();
  expect(stageOptions).toContain('EOI Published');
  expect(stageOptions).not.toContain('Tender Published');
  await dialog.getByLabel(/Current stage/).selectOption({ label: 'EOI Published' });
  await dialog.getByLabel('Next action').fill('Prepare the EOI response');
  await dialog.getByLabel('Due date').fill('2027-03-15');
  await page.screenshot({ path: 'docs/evidence/cr/cr6-create-software-procurement.png' });
  await dialog.getByRole('button', { name: 'Create opportunity' }).click();

  const main = page.locator('#main-content');
  await expect(page.getByRole('heading', { name: NAME })).toBeVisible();
  await expect(main.getByText('Software Procurement (EOI → RFP)')).toBeVisible();

  // The EOI notice: its phase is chosen when it is added.
  await main.getByRole('tab', { name: /Tender/ }).click();
  await main.getByRole('button', { name: 'Add tender' }).first().click();
  const form = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Add tender' }) });
  await form.getByLabel(/^Phase/).selectOption('eoi');
  await form.getByLabel('Tender reference').fill('MOF/EOI/2026/31');
  await form.getByLabel('Publication date').fill('2026-10-01');
  await form.getByLabel(/Submission deadline/).fill('2027-01-20T15:00');
  await form.getByRole('button', { name: 'Add tender' }).click();
  await expect(form).toBeHidden();

  // Mark Submitted offers the EOI's own stage.
  await main.getByRole('button', { name: 'Mark Submitted' }).click();
  const submit = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Mark bid as Submitted' }) });
  await submit.getByLabel('Yes, move the opportunity to EOI Submitted').check();
  await submit.getByRole('button', { name: 'Mark Submitted' }).click();
  await expect(submit).toBeHidden();

  // The outcome: Shortlisted closes the EOI and moves the record on.
  await main.getByRole('button', { name: 'Record EOI outcome' }).click();
  const outcome = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Record EOI outcome' }) });
  await outcome.getByLabel('Shortlisted', { exact: true }).check();
  await outcome.getByLabel('Yes, move it to Shortlisted').check();
  await page.screenshot({ path: 'docs/evidence/cr/cr6-eoi-outcome.png' });
  await outcome.getByRole('button', { name: 'Record outcome' }).click();
  await expect(outcome).toBeHidden();
  await expect(main.getByText('EOI outcome: Shortlisted', { exact: false })).toBeVisible();

  // The RFP follows.
  await main.getByRole('button', { name: 'Add tender' }).first().click();
  const rfp = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Add tender' }) });
  await rfp.getByLabel(/^Phase/).selectOption('rfp');
  await rfp.getByLabel('Tender reference').fill('MOF/RFP/2026/31');
  await rfp.getByLabel('Publication date').fill('2026-10-05');
  await rfp.getByLabel(/Submission deadline/).fill('2027-02-20T15:00');
  await rfp.getByRole('button', { name: 'Add tender' }).click();
  await expect(rfp).toBeHidden();
  await expect(main.getByText('MOF/RFP/2026/31', { exact: false }).first()).toBeVisible();
  await page.screenshot({ path: 'docs/evidence/cr/cr6-tender-tab.png' });

  // The Software Procurement board has its own lanes.
  await page.getByRole('link', { name: 'Opportunities', exact: true }).click();
  await main.getByLabel('Workflow').selectOption('software_procurement');
  await expect(main.getByText('Shortlisted').first()).toBeVisible();
  await expect(main.getByText(NAME)).toBeVisible();
  await expect(main.getByText('Tender Published')).toHaveCount(0);
  await page.screenshot({ path: 'docs/evidence/cr/cr6-board.png' });
});
