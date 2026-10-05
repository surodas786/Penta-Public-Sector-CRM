/**
 * Milestone 2 browser checks (AT-05, AT-06, FR-021).
 *
 * Real drag-and-drop against the real API and the test database: a cancelled
 * or refused move puts the card back exactly where it was, a confirmed move
 * survives a reload, outcome fields are enforced, and completing the last open
 * follow-up asks for its replacement. The permission and integrity rules
 * themselves are proved by the backend suite; this checks the UI honours them.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';

const PASSWORD = process.env.SEED_DEFAULT_PASSWORD ?? 'Synthetic-Dev-2026';
const RAFIQ = 'rafiq.hasan@example.com';

const PORTAL = 'Municipal Service Portal'; // Rafiq, Requirements Discussion
const DOCUMENTS = 'Agency Document Management System'; // Rafiq, Tender Published
const RIVERBANK = 'Riverbank e-Services Portal'; // Rafiq, Awarded

test.describe.configure({ mode: 'serial' });


async function signIn(page: Page, email: string) {
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/opportunities$/);
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

test('a cancelled stage dialog returns the card to its original lane and position', async ({ page }) => {
  await signIn(page, RAFIQ);
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

test('a move the server refuses returns the card and says why', async ({ page }) => {
  await signIn(page, RAFIQ);
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

  // The next stage with a next action in place is sent without a dialog.
  await drag(page, card(lane(page, 'Requirements Discussion'), PORTAL), lane(page, 'Awaiting Tender'));
  await expect(page.getByText(/This record changed after you opened it/)).toBeVisible();

  await expect(card(lane(page, 'Requirements Discussion'), PORTAL)).toBeVisible();
  await expect(card(lane(page, 'Awaiting Tender'), PORTAL)).toHaveCount(0);
  expect(await laneOrder(page, 'Requirements Discussion')).toEqual(before);
  await page.unroute('**/api/opportunities/*/stage');
});

test('a confirmed move persists across a reload', async ({ page }) => {
  await signIn(page, RAFIQ);
  await drag(page, card(lane(page, 'Requirements Discussion'), PORTAL), lane(page, 'Awaiting Tender'));

  await expect(page.getByText('Moved to Awaiting Tender')).toBeVisible();
  await expect(card(lane(page, 'Awaiting Tender'), PORTAL)).toBeVisible();

  await page.reload();
  await expect(card(lane(page, 'Awaiting Tender'), PORTAL)).toBeVisible();
  await expect(card(lane(page, 'Requirements Discussion'), PORTAL)).toHaveCount(0);
});

test('Awarded refuses to save without the actual value, then the card goes back', async ({ page }) => {
  await signIn(page, RAFIQ);
  await drag(page, card(lane(page, 'Tender Published'), DOCUMENTS), lane(page, 'Awarded'));

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Move to Awarded' })).toBeVisible();
  await dialog.getByLabel('Actual awarded value (BDT)').fill('');
  await dialog.getByRole('button', { name: 'Confirm stage change' }).click();

  // The server's field error, next to the field; nothing saved.
  await expect(dialog.getByText('Enter the actual awarded value.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(card(lane(page, 'Tender Published'), DOCUMENTS)).toBeVisible();
  await expect(card(lane(page, 'Awarded'), DOCUMENTS)).toHaveCount(0);
});

test('On Hold keeps the stage and moves the card to the On Hold lane', async ({ page }) => {
  await signIn(page, RAFIQ);
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
  await expect(page.getByText('On Hold — stage retained as Tender Published')).toBeVisible();
});

test('a salesperson cannot drag a closed card', async ({ page }) => {
  await signIn(page, RAFIQ);
  const closed = card(lane(page, 'Awarded'), RIVERBANK);
  await expect(closed).toHaveAttribute('draggable', 'false');
  await expect(closed).toHaveAttribute('title', /Only management can reopen/);
});

test('completing the last open follow-up asks for its replacement', async ({ page }) => {
  await signIn(page, RAFIQ);
  await card(lane(page, 'Awaiting Tender'), PORTAL).getByRole('button').click();
  const main = page.locator('#main-content');
  await main.getByRole('tab', { name: /Follow-ups/ }).click();

  await main.getByRole('button', { name: 'Complete' }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Next follow-up (required)')).toBeVisible();

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
