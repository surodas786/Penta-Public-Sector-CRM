/**
 * Milestone 5 browser checks (FR-050–FR-052, FR-060, FR-061, SEC-010,
 * SEC-011). Runs as its own Playwright run on freshly seeded fixtures, with
 * the development TEST scanner. Three sign-ins, under the login rate limit.
 *
 * The access rules are proved by the backend suite; this checks the approved
 * screens drive the real endpoints end to end. Every file is synthetic and
 * built in memory.
 */
import { expect, test, type Page } from '@playwright/test';

const PASSWORD = process.env.SEED_DEFAULT_PASSWORD ?? 'Synthetic-Dev-2026';

// Harmless EICAR test string, assembled so this file is not itself flagged.
const EICAR = ['X5O!P%@AP[4\\PZX54(P^)7CC)7}$', 'EICAR-STANDARD-ANTIVIRUS-', 'TEST-FILE!$H+H*'].join('');

test.describe.configure({ mode: 'serial' });

async function signIn(page: Page, email: string) {
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/opportunities$/);
}

test('a salesperson tracks tenders, records a submission without moving the stage, and works with private documents', async ({ page }) => {
  await signIn(page, 'rafiq.hasan@example.com');
  const main = page.locator('#main-content');

  // --- Tender Tracker: only his own tenders, with the colour key -------------
  await page.getByRole('link', { name: 'Tender Tracker' }).click();
  await expect(main.getByRole('heading', { name: 'Tender Tracker' })).toBeVisible();
  await expect(main.getByText('Amber — due within 72 hours')).toBeVisible();
  await expect(main.getByRole('row').filter({ hasText: 'DCR/PROC/2026/221' })).toBeVisible();
  await expect(main.getByRole('row').filter({ hasText: 'DPTI/ICT/2026/009' })).toBeVisible();
  await expect(main.getByText('DPTI/ICT/2026/014')).toHaveCount(0); // Tasnia's
  await expect(main.getByRole('combobox', { name: 'Owner' })).toHaveCount(0);

  // --- Mark Submitted asks about the stage, and declining keeps it ------------
  const row = main.getByRole('row').filter({ hasText: 'DCR/PROC/2026/221' });
  await row.getByRole('button', { name: 'Mark Submitted' }).click();
  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Mark bid as Submitted' }) });
  await dialog.getByRole('button', { name: 'Mark Submitted' }).click();
  await expect(dialog.getByText('Choose whether to move the opportunity to Bid Submitted.')).toBeVisible();
  await dialog.getByLabel('No, keep it at Tender Published').check();
  await dialog.getByRole('button', { name: 'Mark Submitted' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(row.getByText('Opportunity stage not yet Bid Submitted')).toBeVisible();

  await row.click();
  await expect(page).toHaveURL(/tab=tender/);
  await expect(main.getByText(/The bid is recorded as Submitted, but the opportunity is still at Tender Published/)).toBeVisible();
  await expect(main.getByText('Tender Published').first()).toBeVisible();

  // --- Documents: upload, scan, download ------------------------------------
  await main.getByRole('tab', { name: /Documents/ }).click();
  await expect(main.getByText(/Stored privately on the server/)).toBeVisible();
  await main.getByLabel('File').setInputFiles({
    name: 'সভার নোট.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Synthetic meeting notes for the browser check.\n'),
  });
  await main.getByLabel('Category').selectOption({ label: 'Meeting Notes' });
  await main.getByRole('button', { name: 'Upload' }).click();
  const uploaded = main.getByRole('row').filter({ hasText: 'সভার নোট.txt' });
  await expect(uploaded).toBeVisible();
  await expect(uploaded.getByText('Scanned (test scanner)')).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await uploaded.getByRole('link', { name: /Download/ }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('সভার নোট.txt');

  // An infected test file is stored but never downloadable.
  await main.getByLabel('File').setInputFiles({
    name: 'Scanner_check.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from(`Synthetic scanner test.\n${EICAR}\n`, 'latin1'),
  });
  await main.getByLabel('Category').selectOption({ label: 'Other' });
  await main.getByRole('button', { name: 'Upload' }).click();
  const infected = main.getByRole('row').filter({ hasText: 'Scanner_check.txt' });
  await expect(infected.getByText('Rejected by scan (test scanner)')).toBeVisible();
  await expect(infected.getByText('Unavailable')).toBeVisible();
  await expect(infected.getByRole('link', { name: /Download/ })).toHaveCount(0);

  // An executable is refused outright.
  await main.getByLabel('File').setInputFiles({
    name: 'setup.exe',
    mimeType: 'application/octet-stream',
    buffer: Buffer.concat([Buffer.from('MZ'), Buffer.alloc(32, 0x90)]),
  });
  await main.getByLabel('Category').selectOption({ label: 'Other' });
  await main.getByRole('button', { name: 'Upload' }).click();
  await expect(main.getByText('Executable and macro-enabled files are not accepted.').first()).toBeVisible();
  await expect(main.getByRole('row').filter({ hasText: 'setup.exe' })).toHaveCount(0);

  // A new revision keeps the earlier one.
  await uploaded.getByRole('button', { name: 'সভার নোট.txt' }).click();
  const documentDialog = page.getByRole('dialog');
  await documentDialog.getByLabel('File').setInputFiles({
    name: 'সভার নোট v2.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Synthetic meeting notes, revised.\n'),
  });
  await documentDialog.getByLabel('What changed').fill('Added the action items');
  await documentDialog.getByRole('button', { name: 'Upload revision' }).click();
  await expect(documentDialog).toHaveCount(0);
  const revised = main.getByRole('row').filter({ hasText: 'সভার নোট v2.txt' });
  await expect(revised.getByText('Revision 2')).toBeVisible();
  // A salesperson cannot archive.
  await revised.getByRole('button', { name: 'সভার নোট v2.txt' }).click();
  await expect(page.getByRole('dialog').getByRole('row')).toHaveCount(3);
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Archive' })).toHaveCount(0);
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();

  await page.getByRole('button', { name: 'Sign out' }).click();
});

test('a section lead re-tenders, and records a late submission that moves the stage on request', async ({ page }) => {
  await signIn(page, 'nadia.islam@example.com');
  const main = page.locator('#main-content');

  // --- Re-tender: the earlier notice is kept as Superseded --------------------
  await page.goto('/opportunities?view=table');
  await main.getByRole('button', { name: /^Agency Document Management System$/ }).click();
  await main.getByRole('tab', { name: /Tender/ }).click();
  await main.getByRole('button', { name: 'Add re-tender / new notice' }).click();
  const form = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Add tender' }) });
  await expect(form.getByText(/DCR\/PROC\/2026\/221.*will be marked Superseded/)).toBeVisible();
  await form.getByLabel('Tender reference').fill('DCR/PROC/2026/240');
  await form.getByLabel('Publication date').fill('2026-10-02');
  await form.getByLabel(/Submission deadline/).fill('2027-01-20T15:00');
  await form.getByRole('button', { name: 'Add tender' }).click();
  await expect(form).toHaveCount(0);
  const earlier = main.locator('section').filter({ has: page.getByRole('heading', { name: 'Earlier notices' }) });
  await expect(earlier.getByRole('row').filter({ hasText: 'DCR/PROC/2026/221' }).getByText('Superseded')).toBeVisible();
  await expect(main.getByText('Ref DCR/PROC/2026/240', { exact: false })).toBeVisible();

  // --- A late submission needs an explanation; the stage moves only on request ---
  await page.goto('/tenders');
  const late = main.getByRole('row').filter({ hasText: 'DPTI/ICT/2026/014' });
  await expect(late.getByText('Deadline missed')).toBeVisible();
  await late.getByRole('button', { name: 'Mark Submitted' }).click();
  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Mark bid as Submitted' }) });
  await dialog.getByLabel(/Bid submitted at/).fill('2026-10-04T13:15');
  await expect(dialog.getByText(/after the recorded deadline/)).toBeVisible();
  await dialog.getByLabel('Yes, move the opportunity to Bid Submitted').check();
  await dialog.getByRole('button', { name: 'Mark Submitted' }).click();
  await expect(dialog.getByText(/Explain the late submission/).first()).toBeVisible();
  await dialog.getByLabel('Explain the late submission').fill('Deadline extended by corrigendum; letter on file.');
  await dialog.getByRole('button', { name: 'Mark Submitted' }).click();
  await expect(dialog).toHaveCount(0);
  // The bid status and the green deadline indicator both read Submitted.
  await expect(late.getByText('Submitted', { exact: true })).toHaveCount(2);

  await late.click();
  await expect(main.getByText('Bid Submitted').first()).toBeVisible();
  await expect(main.getByText(/Late submission: Deadline extended by corrigendum/)).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
});

test('management archives a document with a reason and it stays readable under Show archived', async ({ page }) => {
  await signIn(page, 'arif.rahman@example.com');
  const main = page.locator('#main-content');
  await page.goto('/opportunities?view=table');
  await main.getByRole('button', { name: /^Agency Document Management System$/ }).click();
  await main.getByRole('tab', { name: /Documents/ }).click();

  const revised = main.getByRole('row').filter({ hasText: 'সভার নোট v2.txt' });
  await revised.getByRole('button', { name: 'সভার নোট v2.txt' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Archive' }).click();
  await dialog.getByLabel('Reason for archiving').fill('Superseded by the signed minutes.');
  await dialog.getByRole('button', { name: 'Archive document' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(main.getByRole('row').filter({ hasText: 'সভার নোট v2.txt' })).toHaveCount(0);

  await main.getByLabel('Show archived documents').check();
  const archived = main.getByRole('row').filter({ hasText: 'সভার নোট v2.txt' });
  await expect(archived.getByText('Archived')).toBeVisible();
  await expect(archived.getByRole('link', { name: /Download/ })).toBeVisible();

  await main.getByRole('tab', { name: /Change History/ }).click();
  await expect(main.getByText('Document archived')).toBeVisible();
  await expect(main.getByText('Bid marked Submitted')).toBeVisible();
});
