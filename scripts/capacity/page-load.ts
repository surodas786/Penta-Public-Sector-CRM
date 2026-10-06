/**
 * First-usable-page timing (NFR-011: proposed < 3 s on ordinary office
 * broadband) against the capacity dataset.
 *
 * Serves the PRODUCTION web build (`dist/`, from `npm run build:web`) with
 * `vite preview`, proxying /api to `scripts/capacity/server.ts`, and drives
 * Chromium with an empty cache for every run. "Usable" means the screen's
 * data is on the page, not merely that the document loaded:
 *
 *   sign-in     the Sign in button is visible
 *   dashboard   after signing in, the Active Opportunities card shows a number
 *   list        the opportunity table shows its first row
 *   detail      an opportunity's page shows its name heading
 *
 * Two network profiles: loopback (no shaping) and "office broadband", emulated
 * through the Chrome DevTools Protocol (40 ms latency, 20 Mbit/s down,
 * 5 Mbit/s up). Five runs per role and profile; reports median and max.
 *
 *   npm run build:web && npm run capacity:pages
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { chromium, type Page } from '@playwright/test';

import { capacityPassword } from './target.js';

try {
  process.loadEnvFile('.env');
} catch {
  // The environment may be supplied directly.
}

const API_PORT = 4811;
// 4173 (Vite's default) sits in a Windows-reserved port range on some machines.
const WEB_PORT = 5176;
const ORIGIN = `http://127.0.0.1:${WEB_PORT}`;
const RUNS = Number(process.env.CAPACITY_PAGE_RUNS ?? 5);
const TARGET_MS = 3_000;

const PROFILES = {
  loopback: null,
  'office broadband (40 ms, 20/5 Mbit/s)': { latency: 40, downloadThroughput: (20 * 1024 * 1024) / 8, uploadThroughput: (5 * 1024 * 1024) / 8 },
} as const;
const ROLES = { management: 'cap.management.2@example.com', salesperson: 'cap.sales.2.3@example.com' } as const;

function startProcess(command: string, args: string[], env: NodeJS.ProcessEnv, ready: RegExp): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${command} did not start:\n${output}`));
    }, 60_000);
    const onData = (chunk: Buffer) => {
      // Vite colours parts of its URL; match on the plain text.
      output += chunk.toString().replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g'), '');
      if (ready.test(output)) {
        clearTimeout(timer);
        resolve(child);
      }
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
  });
}

async function measure(page: Page, email: string) {
  const timings: Record<string, number> = {};
  let started = performance.now();
  await page.goto(`${ORIGIN}/sign-in`);
  await page.getByRole('button', { name: 'Sign in' }).waitFor();
  timings['sign-in'] = performance.now() - started;

  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(capacityPassword());
  started = performance.now();
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/dashboard$/);
  await page.getByText('Active Opportunities').first().waitFor();
  await page.getByText('Calculating your dashboard…').waitFor({ state: 'detached' });
  timings.dashboard = performance.now() - started;

  started = performance.now();
  await page.goto(`${ORIGIN}/opportunities?view=table`);
  const firstRow = page.locator('#main-content table tbody tr').first();
  await firstRow.waitFor();
  timings.list = performance.now() - started;

  const firstName = (await firstRow.getByRole('button').first().innerText()).trim();
  started = performance.now();
  await firstRow.getByRole('button').first().click();
  await page.getByRole('heading', { name: firstName }).first().waitFor();
  timings.detail = performance.now() - started;
  return timings;
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
};

async function main(): Promise<void> {
  const api = await startProcess(process.execPath, ['--import', 'tsx', path.join('scripts', 'capacity', 'server.ts')], { CAPACITY_PORT: String(API_PORT), CAPACITY_ORIGIN: ORIGIN }, /listening/);
  const web = await startProcess(process.execPath, [path.join('node_modules', 'vite', 'bin', 'vite.js'), 'preview', '--host', '127.0.0.1', '--port', String(WEB_PORT), '--strictPort'], { PORT: String(API_PORT) }, new RegExp(`Local:.*127[.]0[.]0[.]1:${WEB_PORT}`));
  const browser = await chromium.launch();
  const results: { profile: string; role: string; screen: string; medianMs: number; maxMs: number; runs: number[] }[] = [];
  try {
    for (const [profileName, conditions] of Object.entries(PROFILES)) {
      for (const [role, email] of Object.entries(ROLES)) {
        const runs: Record<string, number>[] = [];
        for (let run = 0; run < RUNS; run += 1) {
          const context = await browser.newContext(); // empty cache and cookies
          const page = await context.newPage();
          if (conditions) {
            const cdp = await context.newCDPSession(page);
            await cdp.send('Network.enable');
            await cdp.send('Network.emulateNetworkConditions', { offline: false, ...conditions });
          }
          runs.push(await measure(page, email));
          await context.close();
        }
        for (const screen of Object.keys(runs[0]!)) {
          const values = runs.map((r) => r[screen]!);
          results.push({ profile: profileName, role, screen, medianMs: Math.round(median(values)), maxMs: Math.round(Math.max(...values)), runs: values.map(Math.round) });
        }
      }
    }
  } finally {
    await browser.close();
    api.kill();
    web.kill();
  }

  const lines = [
    `# First usable page — ${new Date().toISOString()}`,
    '',
    `Production web build served by \`vite preview\`, API from scripts/capacity/server.ts on the capacity dataset, Chromium (Playwright), empty cache per run, ${RUNS} runs. Target: < ${TARGET_MS} ms.`,
    '',
    '| Network | Role | Screen | Median ms | Max ms | Runs |',
    '| --- | --- | --- | ---: | ---: | --- |',
    ...results.map((r) => `| ${r.profile} | ${r.role} | ${r.screen} | ${r.medianMs} | ${r.maxMs} | ${r.runs.join(', ')} |`),
    '',
  ];
  const dir = path.join('docs', 'evidence', 'capacity');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'page-load.md'), `${lines.join('\n')}\n`);
  writeFileSync(path.join(dir, 'page-load.json'), `${JSON.stringify(results, null, 2)}\n`);
  console.log(lines.join('\n'));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  // Child servers must not keep a failed run alive.
  process.exit(1);
});
