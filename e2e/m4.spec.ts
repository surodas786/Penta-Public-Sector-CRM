/**
 * Milestone 4 browser checks (FR-030–FR-033, FR-040, FR-041, BR-020, BR-021,
 * SEC-004). Runs as its own Playwright run on freshly seeded fixtures. Three
 * sign-ins, under the login rate limit.
 *
 * The scoping rules are proved by the backend suite; this checks the screens
 * show only what each person may see and that the main flows work end to end.
 */
import { expect, test, type Page } from '@playwright/test';

const PASSWORD = process.env.SEED_DEFAULT_PASSWORD ?? 'Synthetic-Dev-2026';

// The seed placed each demo contact note on the contact's first link only.
const FARZANA_P2_NOTE = 'Executive sponsor for ERP and eLearning initiatives.';
const GOLAM_P1_NOTE = 'Final approver for city digital projects.';

test.describe.configure({ mode: 'serial' });

async function signIn(page: Page, email: string) {
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/opportunities$/);
}

test('a salesperson works the directory, contacts and activities within their own scope', async ({ page }) => {
  await signIn(page, 'rafiq.hasan@example.com');
  const main = page.locator('#main-content');

  // --- Shared directory, scoped counts --------------------------------------
  await page.getByRole('link', { name: 'Organizations & Contacts' }).click();
  await expect(main.getByRole('heading', { name: 'Organizations & Contacts' })).toBeVisible();
  const sylvan = main.getByRole('row').filter({ hasText: 'Sylvan Hills City Corporation' });
  await expect(sylvan.getByRole('cell').last()).toHaveText('1');
  await sylvan.click();
  await expect(main.getByRole('heading', { name: 'Sylvan Hills City Corporation' })).toBeVisible();
  await expect(main.getByText('1 within your access')).toBeVisible();
  await expect(main.getByRole('cell', { name: 'Municipal Service Portal' })).toBeVisible();
  // Imran's record at the same organization is not shown.
  await expect(main.getByText('City Wi-Fi & Edge Security')).toHaveCount(0);

  // --- A contact shared with a colleague: only his own link and notes -------
  await page.goto('/organizations?tab=contacts');
  await main.getByLabel('Search').fill('Farzana');
  await main.getByRole('row').filter({ hasText: 'Farzana Yasmin' }).click();
  await expect(main.getByRole('heading', { name: 'Farzana Yasmin' })).toBeVisible();
  await expect(main.getByRole('link', { name: 'Training Institute Learning Portal' })).toBeVisible();
  await expect(main.getByText('Public Training Institute ERP')).toHaveCount(0);
  await expect(main.getByText(FARZANA_P2_NOTE)).toHaveCount(0);
  await expect(main.getByText(/Shared with opportunities outside your access/)).toBeVisible();
  await expect(main.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);

  await main.getByRole('button', { name: 'Edit notes' }).click();
  const notes = page.getByRole('dialog');
  await notes.getByLabel('Notes').fill('Prefers a phone call before any meeting.');
  await notes.getByRole('button', { name: 'Save notes' }).click();
  await expect(notes).toHaveCount(0);
  await expect(main.getByText('Prefers a phone call before any meeting.')).toBeVisible();

  // --- New contact in Bangla, from the opportunity's Contacts tab -----------
  await page.goto('/opportunities?view=table');
  await main.getByRole('button', { name: /^Municipal Service Portal$/ }).click();
  await main.getByRole('tab', { name: /Contacts/ }).click();
  await expect(main.getByText(GOLAM_P1_NOTE)).toBeVisible();
  await main.getByRole('button', { name: 'Link a contact' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Add a new contact instead' }).click();

  // The link dialog may still be animating out; address the new one by its heading.
  const contactForm = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Add contact' }) });
  await expect(page.getByRole('heading', { name: 'Link a contact' })).toHaveCount(0);
  await contactForm.getByLabel('Full name').fill('মোঃ রফিকুল ইসলাম');
  await contactForm.getByLabel('Designation').fill('উপসচিব (আইসিটি)');
  await contactForm.getByLabel('Organization').selectOption({ label: 'Sylvan Hills City Corporation' });
  await contactForm.getByLabel('Phone').fill('+880 1700-000999');
  await contactForm.getByLabel('Relationship notes for this opportunity').fill('পোর্টাল প্রকল্পের সমন্বয়ক।');
  await contactForm.getByRole('button', { name: 'Add contact' }).click();
  await expect(contactForm).toHaveCount(0);
  const row = main.getByRole('row').filter({ hasText: 'মোঃ রফিকুল ইসলাম' });
  await expect(row).toBeVisible();
  await expect(row.getByText('পোর্টাল প্রকল্পের সমন্বয়ক।')).toBeVisible();

  // --- Log an activity with the new contact and a next action ---------------
  await main.getByRole('tab', { name: /Activities/ }).click();
  await main.getByRole('button', { name: 'Log Activity' }).first().click();
  const activity = page.getByRole('dialog');
  await activity.getByLabel('Activity type').selectOption('phone_call');
  await activity.getByLabel('Subject').fill('সমন্বয়কের সাথে প্রথম ফোনালাপ');
  await activity.getByLabel('Contact involved').selectOption({ label: 'মোঃ রফিকুল ইসলাম — উপসচিব (আইসিটি)' });
  await activity.getByLabel('Next action').fill('Share the phased delivery plan');
  await activity.getByLabel('Due date').fill('2027-01-20');
  await activity.getByRole('button', { name: 'Log activity' }).click();
  await expect(activity).toHaveCount(0);

  await page.reload();
  await expect(main.getByText('সমন্বয়কের সাথে প্রথম ফোনালাপ')).toBeVisible();
  await expect(main.getByText('Share the phased delivery plan')).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
});

test('a section lead sees every link in the section and may correct the shared identity', async ({ page }) => {
  await signIn(page, 'nadia.islam@example.com');
  const main = page.locator('#main-content');
  await page.goto('/organizations?tab=contacts');
  await main.getByLabel('Search').fill('Farzana');
  await main.getByRole('row').filter({ hasText: 'Farzana Yasmin' }).click();

  const linked = main.locator('section').filter({ has: page.getByRole('heading', { name: 'Linked opportunities' }) });
  await expect(linked.getByRole('link', { name: 'Training Institute Learning Portal' })).toBeVisible();
  await expect(linked.getByRole('link', { name: 'Public Training Institute ERP' })).toBeVisible();
  await expect(linked.getByText(FARZANA_P2_NOTE)).toBeVisible();
  await expect(main.getByRole('button', { name: 'Edit', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
});

test('another section sees a shared contact only through its own record', async ({ page }) => {
  await signIn(page, 'imran.hossain@example.com');
  const main = page.locator('#main-content');
  await page.goto('/organizations?tab=contacts');
  await main.getByLabel('Search').fill('Golam');
  await main.getByRole('row').filter({ hasText: 'Golam Mostafa' }).click();

  const linked = main.locator('section').filter({ has: page.getByRole('heading', { name: 'Linked opportunities' }) });
  await expect(linked.getByRole('link', { name: 'City Wi-Fi & Edge Security' })).toBeVisible();
  await expect(main.getByText('Municipal Service Portal')).toHaveCount(0);
  await expect(main.getByText(GOLAM_P1_NOTE)).toHaveCount(0);
});
