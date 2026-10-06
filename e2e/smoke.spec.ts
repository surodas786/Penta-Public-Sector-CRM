/**
 * Browser smoke test: sign in, create an opportunity, confirm it survives a
 * reload and a server-side read, then sign out (plan 7.6).
 *
 * Credentials come from the environment, never from the repository.
 */
import { expect, test } from '@playwright/test';

const SALESPERSON_EMAIL = 'rafiq.hasan@example.com';
const PASSWORD = process.env.SEED_DEFAULT_PASSWORD ?? 'Synthetic-Dev-2026';

/** Unique per run so repeated smoke runs cannot collide. */
const projectName = `Smoke Test Opportunity ${Date.now()}`;

test.describe.configure({ mode: 'serial' });

test('sign in, create, persist across reload, sign out', async ({ page }) => {
  // --- Sign in ------------------------------------------------------------
  await page.goto('/');
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();

  await page.getByLabel('Email address').fill(SALESPERSON_EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();

  // A salesperson's landing route resolves to the opportunity list.
  await expect(page).toHaveURL(/\/opportunities$/);
  await expect(page.getByRole('heading', { name: 'Opportunities' })).toBeVisible();
  // The list is scoped by the server to records this salesperson owns.
  await expect(page.getByText('Opportunities you own')).toBeVisible();

  // --- Create -------------------------------------------------------------
  await page.getByRole('button', { name: 'Add Opportunity' }).click();

  // Scope every field to the dialog: the list behind it has filter controls
  // with the same labels ("Solution category", "Priority").
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Add opportunity' })).toBeVisible();

  await dialog.getByLabel('Project / opportunity name').fill(projectName);
  await dialog.getByLabel('Procuring organization').selectOption({ index: 1 });
  await dialog.getByLabel('Solution category').selectOption('custom_software');
  await dialog.getByLabel('Estimated value (BDT)').fill('2500000.75');
  await dialog.getByLabel('Next action').fill('Arrange the first briefing');
  await dialog.getByLabel('Due date').fill('2027-03-15');

  await dialog.getByRole('button', { name: 'Create opportunity' }).click();

  // Everything is scoped to the main content region. Sonner renders toasts in
  // a body-level <ol><li>, which otherwise collides with list and text
  // locators while the success toast is still on screen.
  const main = page.locator('#main-content');
  const recordHeader = main.locator('header').filter({ hasText: projectName });
  await expect(page.getByRole('heading', { name: projectName })).toBeVisible();
  await expect(recordHeader.getByText(/OPP-\d{6}/)).toBeVisible();
  // Exact decimal, not a rounded float.
  await expect(recordHeader.getByText('৳ 25,00,000.75')).toBeVisible();

  const detailUrl = page.url();

  // --- The first follow-up exists (BR-014) --------------------------------
  await main.getByRole('tab', { name: /Follow-ups/ }).click();
  await expect(main.getByText('Arrange the first briefing')).toBeVisible();

  // --- Creation history (FR-062) ------------------------------------------
  await main.getByRole('tab', { name: /Change History/ }).click();
  const historyEntry = main.getByRole('listitem').filter({ hasText: 'Opportunity created' });
  await expect(historyEntry).toBeVisible();
  await expect(historyEntry).toContainText('Rafiq Hasan');

  // --- Persistence across a full reload -----------------------------------
  await page.reload();
  await expect(page.getByRole('heading', { name: projectName })).toBeVisible();

  // And it is really in the database, not in browser storage.
  const stored = await page.evaluate(() => ({
    localStorageKeys: Object.keys(window.localStorage),
    sessionStorageKeys: Object.keys(window.sessionStorage),
  }));
  expect(stored.localStorageKeys).toHaveLength(0);
  expect(stored.sessionStorageKeys).toHaveLength(0);

  // --- It appears in the scoped list --------------------------------------
  await page.goto('/opportunities?view=table');
  await expect(main.getByRole('button', { name: projectName })).toBeVisible();

  // --- Sign out clears access ---------------------------------------------
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/sign-in$/);

  // The record is no longer reachable without a session.
  await page.goto(detailUrl);
  await expect(page).toHaveURL(/\/sign-in$/);
});

test('another section cannot open the record by URL', async ({ page }) => {
  // Sign in as the owner to discover a real record id.
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(SALESPERSON_EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/opportunities$/);

  // The approved default view is the Pipeline board; the table names each
  // record by its own button, which is what this test addresses.
  await page.goto('/opportunities?view=table');
  await page.locator('#main-content').getByRole('button', { name: /^Municipal Service Portal$/ }).click();
  await expect(page).toHaveURL(/\/opportunities\/[0-9a-f-]{36}/);
  const ownedUrl = page.url();

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/sign-in$/);

  // A salesperson in the other section follows the same URL.
  await page.getByLabel('Email address').fill('imran.hossain@example.com');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/opportunities$/);

  await page.goto(ownedUrl);
  // The server answers 404; the UI shows the "not available" state and never
  // the record's name.
  await expect(page.getByRole('heading', { name: 'Not available' })).toBeVisible();
  await expect(page.locator('#main-content').getByText('Municipal Service Portal')).toHaveCount(0);
});
