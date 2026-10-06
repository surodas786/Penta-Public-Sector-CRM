/**
 * NFR-012: the Milestone 8 interface checks in Chromium, Microsoft Edge and
 * Firefox, one isolated Playwright run per browser (each run reseeds and
 * stays under the production login rate limit).
 *
 *   npm run test:browsers                 all three
 *   npm run test:browsers -- firefox      one
 *
 * Edge uses the installed browser; Firefox needs `npx playwright install firefox`.
 * A browser that is not available is reported, not silently skipped.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const requested = process.argv.slice(2);
const browsers = requested.length > 0 ? requested : ['chromium', 'msedge', 'firefox'];
const cli = path.join('node_modules', '@playwright', 'test', 'cli.js');
const results: string[] = [];
let failed = false;

for (const browser of browsers) {
  const run = spawnSync(process.execPath, [cli, 'test', 'e2e/m8.spec.ts', `--project=${browser}`], {
    env: { ...process.env, CROSS_BROWSER: 'true' },
    stdio: 'inherit',
  });
  results.push(`${browser}: ${run.status === 0 ? 'passed' : `FAILED (exit ${run.status})`}`);
  if (run.status !== 0) failed = true;
}

console.log(`\nBrowser checks:\n  ${results.join('\n  ')}`);
process.exitCode = failed ? 1 : 0;
