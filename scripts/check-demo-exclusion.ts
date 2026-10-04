/**
 * Production build guard (NFR-001).
 *
 * Fails the build when the synthetic demo could reach a production artefact,
 * and asserts that the server itself refuses an unsafe production
 * configuration. Run by `npm run build:web` and by CI.
 *
 *   npm run check:demo-exclusion
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { loadServerConfig } from '../server/env.js';

const failures: string[] = [];

function fail(message: string): void {
  failures.push(message);
}

// ---------------------------------------------------------------------------
// 1. The frontend demo flag must never be on for a production bundle.
// ---------------------------------------------------------------------------

const buildMode = process.env.VITE_MODE ?? process.env.MODE ?? 'production';
if (process.env.VITE_DEMO_MODE === 'true' && buildMode !== 'demo') {
  fail(
    'VITE_DEMO_MODE=true while building the production bundle. The synthetic demo must be built ' +
      'separately with `npm run build:demo`.',
  );
}

if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEMO_ENDPOINTS === 'true') {
  fail('ALLOW_DEMO_ENDPOINTS=true with NODE_ENV=production.');
}

// ---------------------------------------------------------------------------
// 2. The server must refuse an unsafe production configuration.
// ---------------------------------------------------------------------------

function expectConfigRejection(label: string, environment: Record<string, string>): void {
  const saved = { ...process.env };
  try {
    Object.assign(process.env, environment);
    loadServerConfig();
    fail(`Server configuration accepted an unsafe production setup: ${label}.`);
  } catch {
    // Expected.
  } finally {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, saved);
  }
}

const strongSecret = 'a'.repeat(64);

expectConfigRejection('demo mode enabled in production', {
  NODE_ENV: 'production',
  VITE_DEMO_MODE: 'true',
  SESSION_SECRET: strongSecret,
  CSRF_SECRET: strongSecret,
  DATABASE_URL: 'postgres://user:pass@db:5432/penta_crm_prod',
});

expectConfigRejection('demo endpoints enabled in production', {
  NODE_ENV: 'production',
  ALLOW_DEMO_ENDPOINTS: 'true',
  SESSION_SECRET: strongSecret,
  CSRF_SECRET: strongSecret,
  DATABASE_URL: 'postgres://user:pass@db:5432/penta_crm_prod',
});

expectConfigRejection('placeholder session secret in production', {
  NODE_ENV: 'production',
  SESSION_SECRET: 'replace-me-with-a-32-byte-random-hex-value',
  CSRF_SECRET: strongSecret,
  DATABASE_URL: 'postgres://user:pass@db:5432/penta_crm_prod',
});

// ---------------------------------------------------------------------------
// 3. No demo, seed, reset or user-switch endpoint may be registered.
// ---------------------------------------------------------------------------

/** Route paths the API is allowed to expose. Anything else is a build failure. */
const FORBIDDEN_ROUTE_PATTERNS = [
  /router\s*\.\s*(get|post|put|patch|delete)\s*\(\s*['"`][^'"`]*\b(demo|seed|reset|switch-user|impersonate)\b/i,
  /app\s*\.\s*(get|post|put|patch|delete)\s*\(\s*['"`][^'"`]*\b(demo|seed|reset|switch-user|impersonate)\b/i,
  /app\s*\.\s*use\s*\(\s*['"`][^'"`]*\b(demo|seed|reset)\b/i,
];

function walk(directory: string): string[] {
  const entries: string[] = [];
  for (const name of readdirSync(directory)) {
    const full = path.join(directory, name);
    if (statSync(full).isDirectory()) {
      if (name === 'tests' || name === 'migrations' || name === 'node_modules') continue;
      entries.push(...walk(full));
    } else if (name.endsWith('.ts')) {
      entries.push(full);
    }
  }
  return entries;
}

for (const file of walk(path.resolve('server'))) {
  const source = readFileSync(file, 'utf8');
  for (const pattern of FORBIDDEN_ROUTE_PATTERNS) {
    if (pattern.test(source)) {
      fail(`${path.relative(process.cwd(), file)} appears to register a demo/seed/reset endpoint.`);
    }
  }
}

// ---------------------------------------------------------------------------
// 4. The built production bundle must contain no demo artefact.
//
// Run with --bundle after `vite build`. This is the check that actually proves
// the shipped JavaScript carries no synthetic record, no seed account and no
// browser-storage data layer (NFR-001).
// ---------------------------------------------------------------------------

if (process.argv.includes('--bundle')) {
  const assetsDirectory = path.resolve('dist', 'assets');
  let bundles: string[] = [];
  try {
    bundles = readdirSync(assetsDirectory)
      .filter((name) => name.endsWith('.js'))
      .map((name) => path.join(assetsDirectory, name));
  } catch {
    fail('dist/assets does not exist. Run the build before the bundle check.');
  }

  if (bundles.length === 0) fail('No JavaScript bundle found in dist/assets.');

  /** Strings that may only exist in the synthetic demo. */
  const DEMO_FINGERPRINTS = [
    'Demo: Switch User',
    'Reset Demo Data',
    'Synthetic demo data',
    'penta-crm-demo-v1',
    '@example.com',
    'Sylvan Hills',
    'Meghna Regional Utility',
    'Karnaphuli Port Services',
    '2026-10-02',
    'localStorage',
  ];

  for (const bundle of bundles) {
    const contents = readFileSync(bundle, 'utf8');
    for (const fingerprint of DEMO_FINGERPRINTS) {
      if (contents.includes(fingerprint)) {
        fail(
          `${path.relative(process.cwd(), bundle)} contains "${fingerprint}", which belongs to the ` +
            'synthetic demo and must not ship in a production bundle.',
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

if (failures.length > 0) {
  console.error('Demo-exclusion check FAILED:\n');
  for (const failure of failures) console.error(`  - ${failure}`);
  console.error('\nProduction artefacts must not expose demo controls, seed data or reset endpoints.');
  process.exit(1);
}

console.log('Demo-exclusion check passed: no demo controls, seed accounts or reset endpoints are exposed.');
