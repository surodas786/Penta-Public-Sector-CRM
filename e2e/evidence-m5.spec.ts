/**
 * Milestone 5 screenshot evidence. Run by `npm run evidence` as its own
 * Playwright run on fresh fixtures, with the development TEST scanner. Two
 * sign-ins. Every file is synthetic.
 */
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const PASSWORD = process.env.SEED_DEFAULT_PASSWORD ?? 'Synthetic-Dev-2026';
const OUTPUT = path.resolve('docs', 'evidence');

// Harmless EICAR test string, assembled so this file is not itself flagged.
const EICAR = ['X5O!P%@AP[4\\PZX54(P^)7CC)7}$', 'EICAR-STANDARD-ANTIVIRUS-', 'TEST-FILE!$H+H*'].join('');

async function signIn(page: Page, email: string) {
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/opportunities$/);
}

test('capture Milestone 5 screens', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const main = page.locator('#main-content');
  const shot = (name: string) => page.screenshot({ path: path.join(OUTPUT, `${name}.png`), fullPage: true });

  // --- Section lead: the section's tenders -----------------------------------
  await signIn(page, 'nadia.islam@example.com');
  await page.goto('/tenders');
  await expect(main.getByRole('row').filter({ hasText: 'DPTI/ICT/2026/014' })).toBeVisible();
  await shot('30-tender-tracker-desktop-1440');

  await page.goto('/tenders?view=calendar');
  await expect(main.getByText('This month')).toBeVisible();
  await shot('31-tender-calendar-desktop-1440');

  await page.goto('/tenders');
  await main.getByRole('row').filter({ hasText: 'DCR/PROC/2026/221' }).getByRole('button', { name: 'Mark Submitted' }).click();
  await expect(page.getByRole('dialog').getByText(/Move it to Bid Submitted\?/)).toBeVisible();
  await shot('32-mark-submitted-explicit-stage-choice-desktop-1440');
  await page.getByRole('dialog').getByLabel('No, keep it at Tender Published').check();
  await page.getByRole('dialog').getByRole('button', { name: 'Mark Submitted' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await main.getByRole('row').filter({ hasText: 'DCR/PROC/2026/221' }).click();
  await expect(main.getByText(/The bid is recorded as Submitted/)).toBeVisible();
  await shot('33-tender-tab-stage-mismatch-desktop-1440');

  await main.getByRole('button', { name: 'Add re-tender / new notice' }).click();
  await expect(page.getByRole('dialog').getByText(/will be marked Superseded/)).toBeVisible();
  await shot('34-add-re-tender-desktop-1440');
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'Sign out' }).click();

  // --- Salesperson: private documents ---------------------------------------
  await signIn(page, 'rafiq.hasan@example.com');
  await page.goto('/opportunities?view=table');
  await main.getByRole('button', { name: /^Municipal Service Portal$/ }).click();
  await main.getByRole('tab', { name: /Documents/ }).click();
  const files: [string, string, Buffer][] = [
    ['Workshop_Notes.txt', 'Meeting Notes', Buffer.from('Synthetic workshop notes.\n')],
    ['Scanner_check.txt', 'Other', Buffer.from(`Synthetic scanner test.\n${EICAR}\n`, 'latin1')],
  ];
  for (const [name, category, buffer] of files) {
    await main.getByLabel('File').setInputFiles({ name, mimeType: 'text/plain', buffer });
    await main.getByLabel('Category').selectOption({ label: category });
    await main.getByRole('button', { name: 'Upload' }).click();
    await expect(main.getByRole('row').filter({ hasText: name })).toBeVisible();
  }
  await shot('35-documents-tab-scan-states-desktop-1440');

  await main.getByRole('button', { name: 'Workshop_Notes.txt' }).click();
  await page.getByRole('dialog').getByLabel('File').setInputFiles({
    name: 'Workshop_Notes_v2.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Synthetic workshop notes, revised.\n'),
  });
  await page.getByRole('dialog').getByRole('button', { name: 'Upload revision' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await main.getByRole('button', { name: 'Workshop_Notes_v2.txt' }).click();
  await expect(page.getByRole('dialog').getByRole('row')).toHaveCount(3);
  await shot('36-document-revisions-desktop-1440');
});
