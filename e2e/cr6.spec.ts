/**
 * CR6 browser check: a salesperson records a Software Procurement cycle on an
 * opportunity, takes it through EOI submission and shortlisting to the RFP,
 * declines the offered pipeline change, and finds the cycle in the Software
 * Procurement area and on the dashboard. Management sees the direct-RFP
 * exception; a salesperson does not. Two sign-ins.
 */
import { expect, test, type Page } from '@playwright/test';

const PASSWORD = process.env.SEED_DEFAULT_PASSWORD ?? 'Synthetic-Dev-2026';
const OPPORTUNITY = 'Municipal Service Portal';

async function signIn(page: Page, email: string) {
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/dashboard$/);
}

/** A Dhaka datetime-local value `days` from now. */
function dhakaInput(days: number): string {
  const at = new Date(Date.now() + days * 86_400_000 + 6 * 3_600_000);
  return at.toISOString().slice(0, 16);
}

test('a Software Procurement cycle goes from EOI to RFP without moving the pipeline unasked', async ({ page }) => {
  await signIn(page, 'rafiq.hasan@example.com');
  await page.goto('/opportunities?view=table');
  const main = page.locator('#main-content');
  await main.getByRole('button', { name: new RegExp(`^${OPPORTUNITY}$`) }).click();
  await expect(page.getByRole('heading', { name: OPPORTUNITY })).toBeVisible();
  const stageBefore = await main.getByText(/Requirements Discussion/).first().textContent();
  await page.getByRole('tab', { name: /Software Procurement/ }).click();

  // Add the cycle: the EOI route; no direct-RFP option for a salesperson.
  await main.getByRole('button', { name: 'Add procurement' }).click();
  const form = page.getByRole('dialog');
  await expect(form.getByText('Direct RFP invitation without an EOI')).toHaveCount(0);
  await form.getByLabel('EOI reference').fill('SH/EOI/2026/31');
  await form.getByLabel('Submission method').fill('e-GP portal');
  await form.getByLabel('EOI publication date').fill(dhakaInput(-3).slice(0, 10));
  await form.getByLabel(/^EOI deadline/).fill(dhakaInput(2));
  await page.screenshot({ path: 'docs/evidence/cr/cr6-add-procurement.png' });
  await form.getByRole('button', { name: 'Add procurement' }).click();
  await expect(form).toBeHidden();
  await expect(main.getByText('EOI preparation').first()).toBeVisible();
  await expect(main.getByText('Due within 72 hours').first()).toBeVisible();

  // EOI submitted, then shortlisted: no pipeline offer for these.
  const record = async (milestone: string, fill?: () => Promise<void>) => {
    await main.getByRole('button', { name: 'Record milestone' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Milestone').selectOption({ label: milestone });
    if (fill) await fill();
    return dialog;
  };
  let dialog = await record('EOI submitted');
  await expect(dialog.getByText('A procurement milestone never changes the pipeline by itself.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Record milestone' }).click();
  await expect(dialog).toBeHidden();
  await expect(main.getByText('Moved to EOI submitted')).toBeVisible();
  dialog = await record('Shortlisted');
  await dialog.getByRole('button', { name: 'Record milestone' }).click();
  await expect(dialog).toBeHidden();
  await expect(main.getByText('Moved to Shortlisted')).toBeVisible();

  // The RFP: the matching pipeline stage is offered, and declined.
  dialog = await record('RFP received', async () => {
    await page.getByRole('dialog').getByLabel('RFP reference').fill('SH/RFP/2026/31');
    await page.getByRole('dialog').getByLabel(/^Proposal deadline/).fill(dhakaInput(14));
  });
  await expect(dialog.getByText(/Also move it to Tender Published\?/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Record milestone' }).click();
  await expect(dialog.getByText('Choose whether to move the opportunity to Tender Published.')).toBeVisible();
  await dialog.getByLabel(/No, keep it at/).check();
  await page.screenshot({ path: 'docs/evidence/cr/cr6-milestone-offer.png' });
  await dialog.getByRole('button', { name: 'Record milestone' }).click();
  await expect(dialog).toBeHidden();
  await expect(main.getByText('RFP received').first()).toBeVisible();
  await expect(main.getByText(stageBefore ?? 'Requirements Discussion').first()).toBeVisible();

  // Stage history, from the audit.
  await expect(main.getByText('Moved to Shortlisted')).toBeVisible();
  await page.screenshot({ path: 'docs/evidence/cr/cr6-procurement-tab.png', fullPage: true });

  // The area lists it, with its open deadline; the dashboard shows the panel.
  await page.getByRole('link', { name: 'Software Procurement' }).click();
  await expect(page.getByRole('heading', { name: 'Software Procurement' })).toBeVisible();
  const row = page.getByRole('row').filter({ hasText: 'SH/EOI/2026/31' });
  await expect(row.getByText('RFP received')).toBeVisible();
  await expect(row.getByText('EOI then RFP')).toBeVisible();
  await page.screenshot({ path: 'docs/evidence/cr/cr6-procurement-area.png' });
  await page.getByRole('link', { name: 'Dashboard' }).click();
  await expect(page.getByRole('heading', { name: 'Software Procurement Deadlines' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();

  // Management may record the documented direct-RFP exception.
  await signIn(page, 'arif.rahman@example.com');
  await page.getByRole('link', { name: 'Software Procurement' }).click();
  await page.getByRole('button', { name: 'Add Procurement' }).click();
  const direct = page.getByRole('dialog');
  await direct.getByLabel(/Direct RFP invitation without an EOI/).check();
  await expect(direct.getByLabel('Why is there no EOI?')).toBeVisible();
  await expect(direct.getByLabel('EOI publication date')).toHaveCount(0);
});
