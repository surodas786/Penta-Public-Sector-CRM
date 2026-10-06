/**
 * Milestone 7 browser check (SEC-012, FR-041): the Change History tab pages
 * through every recorded change instead of stopping at the first page.
 *
 * The audit, retry and concurrency rules are proved by the backend suite
 * (server/tests/m7MutationControls.test.ts). This only checks that the
 * approved screen reaches the paginated endpoint. Runs as its own Playwright
 * run on freshly seeded fixtures; one sign-in.
 */
import { expect, test } from '@playwright/test';

const PASSWORD = process.env.SEED_DEFAULT_PASSWORD ?? 'Synthetic-Dev-2026';
const EDITS = 27;

test('a salesperson pages through the full change history of a busy opportunity', async ({ page, baseURL }) => {
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill('rafiq.hasan@example.com');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/dashboard$/);

  // The table view names each record by its own button.
  await page.goto('/opportunities?view=table');
  const main = page.locator('#main-content');
  await main.getByRole('button', { name: /^Municipal Service Portal$/ }).click();
  await expect(page.getByRole('heading', { name: 'Municipal Service Portal' })).toBeVisible();
  const id = new URL(page.url()).pathname.split('/').pop() as string;

  // More changes than one page holds, made through the real, audited endpoint.
  const csrf = (await (await page.request.get('/api/auth/csrf')).json()) as { csrfToken: string };
  const headers = { 'x-csrf-token': csrf.csrfToken, Origin: new URL(baseURL as string).origin };
  for (let index = 0; index < EDITS; index += 1) {
    const { version } = (await (await page.request.get(`/api/opportunities/${id}`)).json()) as { version: number };
    const response = await page.request.patch(`/api/opportunities/${id}`, {
      headers,
      data: { version, description: `Scope revision ${index}` },
    });
    expect(response.status()).toBe(200);
  }

  await page.reload();
  await main.getByRole('tab', { name: /Change History/ }).click();
  await expect(main.getByText(`Showing 1–25 of ${EDITS}`)).toBeVisible();
  await expect(main.getByText(`Scope revision ${EDITS - 1}`).first()).toBeVisible();
  await expect(main.getByText('Scope revision 0', { exact: true })).toHaveCount(0);

  await main.getByRole('button', { name: 'Next page' }).click();
  await expect(main.getByText(`Showing 26–${EDITS} of ${EDITS}`)).toBeVisible();
  // The oldest edit, which page one did not show.
  await expect(main.getByText('Scope revision 0', { exact: true }).first()).toBeVisible();
});
