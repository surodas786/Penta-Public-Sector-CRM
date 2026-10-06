/**
 * Milestone 2 browser checks (AT-05, AT-06, FR-021, BR-011, BR-012, BR-014).
 *
 * Real drag-and-drop against the real API and the test database. Each test
 * maps to one of the Milestone 2 review flows: a move persists across a
 * reload; Awarded without value/date and Lost without a reason are refused;
 * On Hold keeps the stage; the last open follow-up needs a replacement unless
 * the record is On Hold; a salesperson cannot reopen a closed record and
 * management can, with a reason. A cancelled or refused move puts the card
 * back where it was.
 *
 * The salesperson tests share one signed-in page: the whole browser run must
 * stay under the login rate limit (10 per 15 minutes, SEC-031), which is not
 * relaxed for tests. Set REVIEW_SHOTS to a directory to save a screenshot of
 * each review flow's outcome.
 */
import path from 'node:path';

import { expect, test, type Locator, type Page } from '@playwright/test';

const PASSWORD = process.env.SEED_DEFAULT_PASSWORD ?? 'Synthetic-Dev-2026';
const RAFIQ = 'rafiq.hasan@example.com';
const ARIF = 'arif.rahman@example.com';

const PORTAL = 'Municipal Service Portal'; // Rafiq, Requirements Discussion
const DOCUMENTS = 'Agency Document Management System'; // Rafiq, Tender Published
const TRAINING = 'Training Institute Learning Portal'; // Rafiq, Bid Submitted
const RIVERBANK = 'Riverbank e-Services Portal'; // Rafiq, Awarded

test.describe.configure({ mode: 'serial' });

async function signIn(page: Page, email: string) {
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/opportunities$/);
}

async function shot(page: Page, name: string) {
  const directory = process.env.REVIEW_SHOTS;
  if (directory) await page.screenshot({ path: path.join(directory, `${name}.png`), fullPage: true });
}

const lane = (page: Page, title: string) => page.getByRole('region', { name: `${title} column` });
const card = (scope: Locator, name: string) => scope.getByRole('listitem').filter({ hasText: name });

/**
 * Drags a card to a lane. The twelve lanes scroll horizontally, and
 * Playwright's `dragTo` can scroll the board between mouse-down and the drag
 * actually starting — which would start the drag on whichever card is then
 * under the pointer. Starting the drag on the source first avoids that.
 */
async function drag(page: Page, source: Locator, target: Locator) {
  await source.scrollIntoViewIfNeeded();
  const box = await source.boundingBox();
  if (!box) throw new Error('source card is not visible');
  await page.mouse.move(box.x + box.width / 2, box.y + 12);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 8, box.y + 20, { steps: 4 });
  await target.scrollIntoViewIfNeeded();
  const targetBox = await target.boundingBox();
  if (!targetBox) throw new Error('target lane is not visible');
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + 60, { steps: 8 });
  await page.mouse.up();
}

/** Card names in a lane, in display order. */
async function laneOrder(page: Page, title: string): Promise<string[]> {
  return lane(page, title)
    .getByRole('listitem')
    .locator('span.leading-snug') // the card's name, not its due tag
    .allInnerTexts();
}

/** One salesperson session for every test that does not change account. */
let page: Page;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await signIn(page, RAFIQ);
});

test.afterAll(async () => {
  await page.close();
});

async function board() {
  await page.goto('/opportunities');
  await expect(lane(page, 'Identified')).toBeVisible();
}

test('a cancelled stage dialog returns the card to its original lane and position', async () => {
  await board();
  await expect(card(lane(page, 'Requirements Discussion'), PORTAL)).toBeVisible();
  const before = await laneOrder(page, 'Requirements Discussion');
  expect(before).toContain(PORTAL);

  // Skipping stages needs an explanation, so a dialog opens.
  await drag(page, card(lane(page, 'Requirements Discussion'), PORTAL), lane(page, 'Bid Preparation'));

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Move to Bid Preparation' })).toBeVisible();
  await expect(card(lane(page, 'Bid Preparation'), PORTAL).getByText('Not saved yet')).toBeVisible();

  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);

  await expect(card(lane(page, 'Bid Preparation'), PORTAL)).toHaveCount(0);
  await expect(page.getByText('Not saved yet')).toHaveCount(0);
  expect(await laneOrder(page, 'Requirements Discussion')).toEqual(before);
});

test('a move the server refuses returns the card and says why', async () => {
  await board();
  await expect(card(lane(page, 'Requirements Discussion'), PORTAL)).toBeVisible();
  const before = await laneOrder(page, 'Requirements Discussion');
  expect(before).toContain(PORTAL);

  await page.route('**/api/opportunities/*/stage', (route) =>
    route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 'version_conflict',
        message: 'This record changed after you opened it. Reload to see the current values, then reapply your edit.',
        requestId: 'e2e-simulated',
      }),
    }),
  );

  try {
    // The next stage with a next action in place is sent without a dialog.
    await drag(page, card(lane(page, 'Requirements Discussion'), PORTAL), lane(page, 'Awaiting Tender'));
    await expect(page.getByText(/This record changed after you opened it/)).toBeVisible();

    await expect(card(lane(page, 'Requirements Discussion'), PORTAL)).toBeVisible();
    await expect(card(lane(page, 'Awaiting Tender'), PORTAL)).toHaveCount(0);
    expect(await laneOrder(page, 'Requirements Discussion')).toEqual(before);
  } finally {
    await page.unroute('**/api/opportunities/*/stage');
  }
});

test('review 1: a moved card stays moved after a reload', async () => {
  await board();
  await drag(page, card(lane(page, 'Requirements Discussion'), PORTAL), lane(page, 'Awaiting Tender'));

  await expect(page.getByText('Moved to Awaiting Tender')).toBeVisible();
  await expect(card(lane(page, 'Awaiting Tender'), PORTAL)).toBeVisible();

  await page.reload();
  await expect(card(lane(page, 'Awaiting Tender'), PORTAL)).toBeVisible();
  await expect(card(lane(page, 'Requirements Discussion'), PORTAL)).toHaveCount(0);
  await shot(page, 'review-1-move-persists-after-reload');
});

test('review 2a: Awarded without an actual value or award date is refused', async () => {
  await board();
  await drag(page, card(lane(page, 'Tender Published'), DOCUMENTS), lane(page, 'Awarded'));

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Move to Awarded' })).toBeVisible();
  await dialog.getByLabel('Actual awarded value (BDT)').fill('');
  await dialog.getByLabel('Award date').fill('');
  await dialog.getByRole('button', { name: 'Confirm stage change' }).click();

  // The server's field errors, next to their fields; nothing saved.
  await expect(dialog.getByText('Enter the actual awarded value.')).toBeVisible();
  await expect(dialog.getByText('Enter the award date.')).toBeVisible();
  await shot(page, 'review-2a-awarded-refused');

  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(card(lane(page, 'Tender Published'), DOCUMENTS)).toBeVisible();
  await expect(card(lane(page, 'Awarded'), DOCUMENTS)).toHaveCount(0);
});

test('review 2b: Lost without a reason is refused', async () => {
  await board();
  await drag(page, card(lane(page, 'Bid Submitted'), TRAINING), lane(page, 'Lost'));

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Move to Lost' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Confirm stage change' }).click();

  await expect(dialog.getByText('Choose the reason the opportunity was lost.')).toBeVisible();
  await shot(page, 'review-2b-lost-refused');

  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(card(lane(page, 'Bid Submitted'), TRAINING)).toBeVisible();
  await expect(card(lane(page, 'Lost'), TRAINING)).toHaveCount(0);
});

test('review 3: On Hold keeps the previous stage', async () => {
  await board();
  await drag(page, card(lane(page, 'Tender Published'), DOCUMENTS), lane(page, 'On Hold'));

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Move to On Hold' })).toBeVisible();
  await dialog.getByLabel('Note').fill('Ministry budget review until next quarter.');
  await dialog.getByRole('button', { name: 'Confirm status change' }).click();
  await expect(dialog).toHaveCount(0);

  await page.reload();
  const held = card(lane(page, 'On Hold'), DOCUMENTS);
  await expect(held).toBeVisible();

  await held.getByRole('button').click();
  const main = page.locator('#main-content');
  await expect(main.getByText('On Hold — stage retained as Tender Published')).toBeVisible();
  await expect(main.getByText('Ministry budget review until next quarter.')).toBeVisible();
  await shot(page, 'review-3-on-hold-keeps-stage');
});

test('review 4a: completing the last open follow-up requires a replacement', async () => {
  await board();
  await card(lane(page, 'Awaiting Tender'), PORTAL).getByRole('button').click();
  const main = page.locator('#main-content');
  await main.getByRole('tab', { name: /Follow-ups/ }).click();

  await main.getByRole('button', { name: 'Complete' }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Next follow-up (required)')).toBeVisible();
  // It also says how to stop work instead of replacing the task.
  await expect(dialog.getByText(/put the opportunity On Hold, cancel it or record its outcome/)).toBeVisible();

  // Submitting without the replacement is refused by the server.
  await dialog.getByRole('button', { name: 'Mark complete' }).click();
  await expect(dialog.getByText('Describe the next action in at least 3 characters.')).toBeVisible();
  await shot(page, 'review-4a-replacement-required');

  await dialog.getByLabel('Completion note').fill('Scope confirmed in writing.');
  await dialog.getByLabel('Next action').fill('Send the revised proposal');
  await dialog.getByLabel('Due date').fill('2027-02-10');
  await dialog.getByRole('button', { name: 'Mark complete' }).click();
  await expect(dialog).toHaveCount(0);

  await page.reload();
  await main.getByRole('tab', { name: 'Overview' }).click();
  await expect(main.getByText('Send the revised proposal')).toBeVisible();
  await main.getByRole('tab', { name: /Change History/ }).click();
  await expect(main.getByText('Follow-up completed').first()).toBeVisible();
  await expect(main.getByText('Stage changed').first()).toBeVisible();
});

test('review 4b: an On Hold record may close its last follow-up without a replacement', async () => {
  await board();
  await card(lane(page, 'On Hold'), DOCUMENTS).getByRole('button').click();
  const main = page.locator('#main-content');
  await main.getByRole('tab', { name: /Follow-ups/ }).click();

  await main.getByRole('button', { name: 'Complete' }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Next follow-up (required)')).toHaveCount(0);
  await expect(dialog.getByText('Also schedule the next follow-up')).toBeVisible();
  await dialog.getByRole('button', { name: 'Mark complete' }).click();
  await expect(dialog).toHaveCount(0);

  await expect(main.getByRole('button', { name: 'Complete' })).toHaveCount(0);
  await shot(page, 'review-4b-on-hold-closes-last-task');
});

test('review 5a: a salesperson cannot reopen an Awarded opportunity', async () => {
  await board();
  const closed = card(lane(page, 'Awarded'), RIVERBANK);
  await expect(closed).toHaveAttribute('draggable', 'false');
  await expect(closed).toHaveAttribute('title', /Only management can reopen/);

  await closed.getByRole('button').click();
  const main = page.locator('#main-content');
  await expect(main.getByRole('heading', { name: RIVERBANK })).toBeVisible();
  await expect(main.getByText('Closed as Awarded. Only management can reopen it.')).toBeVisible();
  await expect(main.getByRole('button', { name: 'Reopen' })).toHaveCount(0);
  await expect(main.getByRole('combobox', { name: 'Change stage' })).toHaveCount(0);
  await shot(page, 'review-5a-salesperson-cannot-reopen');
});

test('review 5b: management reopens with a reason', async ({ browser }) => {
  const manager = await browser.newPage();
  try {
    await signIn(manager, ARIF);
    await card(lane(manager, 'Awarded'), RIVERBANK).getByRole('button').click();
    const main = manager.locator('#main-content');
    await main.getByRole('button', { name: 'Reopen' }).click();

    const dialog = manager.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Reopen opportunity' })).toBeVisible();

    // No reason and no next action: refused.
    await dialog.getByRole('button', { name: 'Reopen opportunity' }).click();
    await expect(dialog.getByText('Explain why the opportunity is being reopened.')).toBeVisible();
    await expect(dialog.getByText('Describe the next action in at least 3 characters.')).toBeVisible();

    await dialog.getByLabel('Reopen at stage').selectOption('evaluation');
    await dialog.getByLabel('Reason for reopening').fill('Award withdrawn after a procedural challenge.');
    await dialog.getByLabel('Next action').fill('Request the re-evaluation timetable');
    await dialog.getByLabel('Due date').fill('2027-01-20');
    await dialog.getByRole('button', { name: 'Reopen opportunity' }).click();
    await expect(dialog).toHaveCount(0);

    await manager.reload();
    await expect(main.getByText('Evaluation', { exact: true }).first()).toBeVisible();
    await main.getByRole('tab', { name: /Change History/ }).click();
    const reopened = main.getByRole('listitem').filter({ hasText: 'Opportunity reopened' });
    await expect(reopened).toContainText('Reason: Award withdrawn after a procedural challenge.');
    // The previous outcome stays in history.
    await expect(reopened).toContainText('Awarded value');
    await shot(manager, 'review-5b-management-reopened-with-reason');
  } finally {
    await manager.close();
  }
});
