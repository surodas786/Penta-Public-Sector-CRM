/**
 * Production-mode server check (NFR-001, SEC-010, SEC-031).
 *
 * Starts the COMPILED server (`dist-server/`, from `npm run build:server`)
 * with NODE_ENV=production against the development database, and checks what
 * a deployment would actually do rather than what its configuration functions
 * return in isolation:
 *
 *   - the development TEST scanner is refused at start-up;
 *   - with DOCUMENT_SCANNER=none it starts, and says files stay unavailable;
 *   - security headers are present (HSTS among them);
 *   - cookies are Secure and SameSite=Strict, and no session cookie is sent
 *     over plain HTTP;
 *   - no demo, seed, reset or user-switch endpoint answers;
 *   - an unauthenticated commercial request is 401;
 *   - the readiness probe reports the database without exposing anything.
 *
 *   npm run build:server && npm run check:production-server
 *
 * Uses throwaway random secrets and a private storage directory. Writes
 * nothing to the database.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

try {
  process.loadEnvFile('.env');
} catch {
  // CI provides the environment directly.
}

const ENTRY = path.join('dist-server', 'server', 'index.js');
const PORT = 4899;
const ORIGIN = 'https://crm.example.invalid';
const failures: string[] = [];
const passes: string[] = [];

function check(label: string, ok: boolean, detail = ''): void {
  (ok ? passes : failures).push(ok ? label : `${label}${detail ? ` — ${detail}` : ''}`);
}

function productionEnv(scanner: string): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    NODE_ENV: 'production',
    DATABASE_URL: process.env.DATABASE_URL,
    SESSION_SECRET: randomBytes(32).toString('hex'),
    CSRF_SECRET: randomBytes(32).toString('hex'),
    APP_ORIGIN: ORIGIN,
    PORT: String(PORT),
    HOST: '127.0.0.1',
    DOCUMENT_SCANNER: scanner,
    DOCUMENT_STORAGE_DIR: mkdtempSync(path.join(os.tmpdir(), 'penta-prodcheck-')),
    JOBS_ENABLED: 'false',
  };
}

function start(scanner: string): { child: ChildProcess; output: () => string; exited: Promise<number | null> } {
  const child = spawn(process.execPath, [ENTRY], { env: productionEnv(scanner), stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString()));
  child.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString()));
  const exited = new Promise<number | null>((resolve) => child.on('exit', (code) => resolve(code)));
  return { child, output: () => output, exited };
}

async function waitForListening(output: () => string): Promise<boolean> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (output().includes('listening on')) return true;
    if (output().includes('Failed to start')) return false;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

async function main(): Promise<void> {
  if (!existsSync(ENTRY)) throw new Error(`${ENTRY} not found. Run \`npm run build:server\` first.`);
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required (the development database is fine).');

  // 1. The development scanner is refused.
  const refused = start('test');
  const code = await Promise.race([refused.exited, new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), 15_000))]);
  if (code === 'timeout') refused.child.kill();
  check(
    'refuses DOCUMENT_SCANNER=test in production',
    code !== 'timeout' && code !== 0 && /must not be used in production/.test(refused.output()),
    refused.output().slice(0, 200),
  );

  // 2. With no scanner it starts, and warns that files stay unavailable.
  const server = start('none');
  try {
    const up = await waitForListening(server.output);
    check('starts in production with DOCUMENT_SCANNER=none', up, server.output().slice(0, 300));
    if (!up) return;
    check('warns that documents stay unavailable without a scanner', /stay unavailable/.test(server.output()));

    const base = `http://127.0.0.1:${PORT}`;
    const health = await fetch(`${base}/api/health`);
    check('liveness probe answers 200', health.status === 200);
    for (const header of ['strict-transport-security', 'x-content-type-options', 'referrer-policy', 'x-frame-options']) {
      check(`sends ${header}`, health.headers.has(header));
    }
    check('does not advertise the framework', !health.headers.has('x-powered-by'));

    const ready = await fetch(`${base}/api/health/ready`);
    const readyBody = await ready.text();
    check('readiness probe reports the database', ready.status === 200 && /"database":"ok"/.test(readyBody), readyBody);
    check('readiness probe exposes no connection detail', !/postgres|penta_app|password|55432/i.test(readyBody), readyBody);

    const csrf = await fetch(`${base}/api/auth/csrf`);
    const cookies = csrf.headers.getSetCookie();
    check('sets cookies only with Secure and SameSite=Strict', cookies.length > 0 && cookies.every((c) => /;\s*Secure/i.test(c) && /SameSite=Strict/i.test(c)), cookies.join(' | '));
    check('sends no session cookie over plain HTTP', !cookies.some((c) => c.startsWith('penta.sid=')), cookies.join(' | '));

    for (const probe of ['/api/demo/reset', '/api/dev/seed', '/api/auth/switch-user', '/api/auth/demo-login', '/api/reset']) {
      const response = await fetch(`${base}${probe}`, { method: 'POST', headers: { Origin: ORIGIN } });
      check(`no endpoint at POST ${probe}`, response.status === 404 || response.status === 403, String(response.status));
    }
    const commercial = await fetch(`${base}/api/opportunities`);
    check('unauthenticated commercial request is 401', commercial.status === 401, String(commercial.status));
  } finally {
    server.child.kill();
  }
}

main()
  .catch((error: unknown) => failures.push(error instanceof Error ? error.message : String(error)))
  .finally(() => {
    for (const line of passes) console.log(`  pass  ${line}`);
    for (const line of failures) console.log(`  FAIL  ${line}`);
    console.log(`${passes.length} passed, ${failures.length} failed.`);
    process.exitCode = failures.length > 0 ? 1 : 0;
  });
