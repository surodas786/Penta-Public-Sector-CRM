/**
 * Capacity load test (NFR-010, NFR-011).
 *
 * Starts `scripts/capacity/server.ts` in its own process, signs in 30
 * distinct synthetic users (3 management, 6 section leads, 21 salespeople)
 * and runs them concurrently through a weighted mix of the ordinary screens'
 * API calls, plus a share of writes. Two phases:
 *
 *   paced       each user waits 1–3 s between requests (people reading screens)
 *   saturation  no waiting: 30 requests always in flight, the worst case
 *
 * Reports p50 / p95 / p99 / max per endpoint and overall, errors, and
 * throughput, and writes JSON and Markdown to docs/evidence/capacity/.
 *
 *   npm run capacity:seed && npm run capacity:load
 *   CAPACITY_PACED_SECONDS=180 CAPACITY_SATURATION_SECONDS=90 (defaults)
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import pg from 'pg';

import { createDatabase } from '../../server/db/client.js';
import { runNotificationScan } from '../../server/services/notifications.js';
import { capacityPassword, capacityUrls } from './target.js';

try {
  process.loadEnvFile('.env');
} catch {
  // The environment may be supplied directly.
}

const PORT = Number(process.env.CAPACITY_PORT ?? 4810);
const ORIGIN = process.env.CAPACITY_ORIGIN ?? 'http://127.0.0.1:4173';
const BASE = `http://127.0.0.1:${PORT}`;
const PACED_SECONDS = Number(process.env.CAPACITY_PACED_SECONDS ?? 180);
const SATURATION_SECONDS = Number(process.env.CAPACITY_SATURATION_SECONDS ?? 90);
const TARGET_P95_MS = 2_000;

// --- A tiny cookie-aware client ---------------------------------------------

class Client {
  private cookies = new Map<string, string>();
  csrf = '';
  constructor(readonly email: string) {}

  private absorb(response: Response): void {
    for (const header of response.headers.getSetCookie()) {
      const [pair] = header.split(';');
      const index = pair!.indexOf('=');
      this.cookies.set(pair!.slice(0, index), pair!.slice(index + 1));
    }
  }

  async request(method: string, url: string, body?: unknown, extra: Record<string, string> = {}): Promise<{ status: number; json: unknown }> {
    const headers: Record<string, string> = { ...extra, cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ') };
    if (method !== 'GET') {
      headers.origin = ORIGIN;
      headers['x-csrf-token'] = this.csrf;
      headers['content-type'] = 'application/json';
    }
    const response = await fetch(`${BASE}${url}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    this.absorb(response);
    const text = await response.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: response.status, json };
  }

  async signIn(): Promise<void> {
    const bootstrap = await this.request('GET', '/api/auth/csrf');
    this.csrf = (bootstrap.json as { csrfToken: string }).csrfToken;
    const login = await this.request('POST', '/api/auth/login', { email: this.email, password: capacityPassword() });
    if (login.status !== 200) throw new Error(`Sign-in failed for ${this.email}: ${login.status}`);
    this.csrf = (login.json as { csrfToken: string }).csrfToken;
  }
}

// --- Measurements -----------------------------------------------------------

interface Sample {
  phase: string;
  label: string;
  ms: number;
  status: number;
}
const samples: Sample[] = [];
let phase = 'warm-up';

async function timed(client: Client, label: string, method: string, url: string, body?: unknown, extra?: Record<string, string>) {
  const started = performance.now();
  const result = await client.request(method, url, body, extra);
  samples.push({ phase, label, ms: performance.now() - started, status: result.status });
  return result;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

// --- The workload -------------------------------------------------------------

const REPORTS = ['pipeline', 'section_owner', 'overdue_follow_ups', 'upcoming_tenders', 'outcomes', 'lost_reasons'];
const FOLLOW_UP_VIEWS = ['open', 'overdue', 'today', 'upcoming', 'completed'];
const STAGES = ['identified', 'requirements_discussion', 'tender_published', 'bid_preparation', 'evaluation'];
const pick = <T,>(items: readonly T[]): T => items[Math.floor(Math.random() * items.length)]!;

interface UserState {
  client: Client;
  opportunityIds: string[];
  role: string;
}

type Step = (user: UserState) => Promise<unknown>;

const steps: [number, string, Step][] = [
  [10, 'GET /api/dashboard', (u) => timed(u.client, 'GET /api/dashboard', 'GET', '/api/dashboard')],
  [
    16,
    'GET /api/opportunities (page, filter, sort)',
    async (u) => {
      const params = new URLSearchParams({ page: String(1 + Math.floor(Math.random() * 3)), pageSize: '25' });
      if (Math.random() < 0.4) params.set('stage', pick(STAGES));
      if (Math.random() < 0.3) params.set('sort', pick(['estimatedValue', 'createdAt']));
      const result = await timed(u.client, 'GET /api/opportunities (page, filter, sort)', 'GET', `/api/opportunities?${params}`);
      const items = (result.json as { items?: { id: string }[] } | null)?.items ?? [];
      if (items.length > 0) u.opportunityIds = items.map((item) => item.id);
      return result;
    },
  ],
  [5, 'GET /api/opportunities?q=', (u) => timed(u.client, 'GET /api/opportunities?q=', 'GET', `/api/opportunities?q=${encodeURIComponent(pick(['Capacity Opportunity 12', 'প্রকল্প', 'Opportunity 9']))}`)],
  [4, 'GET /api/opportunities/board', (u) => timed(u.client, 'GET /api/opportunities/board', 'GET', '/api/opportunities/board')],
  [12, 'GET /api/opportunities/:id', (u) => withOpportunity(u, (id) => timed(u.client, 'GET /api/opportunities/:id', 'GET', `/api/opportunities/${id}`))],
  [4, 'GET …/:id/follow-ups', (u) => withOpportunity(u, (id) => timed(u.client, 'GET …/:id/follow-ups', 'GET', `/api/opportunities/${id}/follow-ups`))],
  [4, 'GET …/:id/activities', (u) => withOpportunity(u, (id) => timed(u.client, 'GET …/:id/activities', 'GET', `/api/opportunities/${id}/activities?pageSize=25`))],
  [4, 'GET …/:id/history', (u) => withOpportunity(u, (id) => timed(u.client, 'GET …/:id/history', 'GET', `/api/opportunities/${id}/history?pageSize=25`))],
  [3, 'GET …/:id/contacts', (u) => withOpportunity(u, (id) => timed(u.client, 'GET …/:id/contacts', 'GET', `/api/opportunities/${id}/contacts`))],
  [2, 'GET …/:id/tenders', (u) => withOpportunity(u, (id) => timed(u.client, 'GET …/:id/tenders', 'GET', `/api/opportunities/${id}/tenders`))],
  [2, 'GET …/:id/documents', (u) => withOpportunity(u, (id) => timed(u.client, 'GET …/:id/documents', 'GET', `/api/opportunities/${id}/documents`))],
  [7, 'GET /api/follow-ups', (u) => timed(u.client, 'GET /api/follow-ups', 'GET', `/api/follow-ups?view=${pick(FOLLOW_UP_VIEWS)}`)],
  [4, 'GET /api/activities', (u) => timed(u.client, 'GET /api/activities', 'GET', '/api/activities')],
  [4, 'GET /api/tenders', (u) => timed(u.client, 'GET /api/tenders', 'GET', '/api/tenders')],
  [4, 'GET /api/reports/:report', (u) => timed(u.client, 'GET /api/reports/:report', 'GET', `/api/reports/${pick(REPORTS)}`)],
  [4, 'GET /api/search', (u) => timed(u.client, 'GET /api/search', 'GET', `/api/search?q=${encodeURIComponent(pick(['Capacity', 'সভা', 'CAP/12', 'Contact 7']))}`)],
  [5, 'GET /api/notifications/unread-count', (u) => timed(u.client, 'GET /api/notifications/unread-count', 'GET', '/api/notifications/unread-count', undefined, { 'x-background-request': '1' })],
  [2, 'GET /api/contacts', (u) => timed(u.client, 'GET /api/contacts', 'GET', '/api/contacts')],
  [2, 'GET /api/organizations', (u) => timed(u.client, 'GET /api/organizations', 'GET', '/api/organizations?q=Organization')],
  [
    3,
    'POST …/:id/activities',
    (u) =>
      withOpportunity(u, (id) =>
        timed(u.client, 'POST …/:id/activities', 'POST', `/api/opportunities/${id}/activities`, {
          type: 'phone_call',
          occurredAt: new Date(Date.now() - 60_000).toISOString(),
          subject: 'Load-test call',
        }, { 'idempotency-key': `load-${crypto.randomUUID()}` }),
      ),
  ],
  [
    2,
    'PATCH /api/opportunities/:id',
    (u) =>
      withOpportunity(u, async (id) => {
        const detail = await u.client.request('GET', `/api/opportunities/${id}`);
        const record = detail.json as { version?: number; stage?: string; status?: string } | null;
        if (!record?.version || record.stage === 'awarded' || record.stage === 'lost' || record.status === 'cancelled') return;
        return timed(u.client, 'PATCH /api/opportunities/:id', 'PATCH', `/api/opportunities/${id}`, {
          version: record.version,
          description: `Load-test edit ${Date.now()}`,
        });
      }),
  ],
];
const totalWeight = steps.reduce((sum, [weight]) => sum + weight, 0);

async function withOpportunity(user: UserState, run: (id: string) => Promise<unknown>) {
  if (user.opportunityIds.length === 0) return;
  return run(pick(user.opportunityIds));
}

function chooseStep(): Step {
  let roll = Math.random() * totalWeight;
  for (const [weight, , step] of steps) {
    roll -= weight;
    if (roll <= 0) return step;
  }
  return steps[0]![2];
}

async function runPhase(users: UserState[], name: string, seconds: number, thinkMs: [number, number]) {
  phase = name;
  const deadline = Date.now() + seconds * 1000;
  await Promise.all(
    users.map(async (user) => {
      while (Date.now() < deadline) {
        await chooseStep()(user);
        const [low, high] = thinkMs;
        if (high > 0) await new Promise((resolve) => setTimeout(resolve, low + Math.random() * (high - low)));
      }
    }),
  );
}

// --- Report -------------------------------------------------------------------

function summarise(name: string, seconds: number) {
  const inPhase = samples.filter((sample) => sample.phase === name);
  const byLabel = new Map<string, Sample[]>();
  for (const sample of inPhase) byLabel.set(sample.label, [...(byLabel.get(sample.label) ?? []), sample]);
  const rows = [...byLabel].map(([label, list]) => {
    const sorted = list.map((s) => s.ms).sort((a, b) => a - b);
    return {
      label,
      count: list.length,
      errors: list.filter((s) => s.status >= 500 || s.status === 0).length,
      unexpected4xx: list.filter((s) => s.status >= 400 && s.status < 500 && s.status !== 409).length,
      p50: Math.round(percentile(sorted, 50)),
      p95: Math.round(percentile(sorted, 95)),
      p99: Math.round(percentile(sorted, 99)),
      max: Math.round(sorted[sorted.length - 1] ?? 0),
    };
  });
  rows.sort((a, b) => b.p95 - a.p95);
  const all = inPhase.map((s) => s.ms).sort((a, b) => a - b);
  return {
    phase: name,
    seconds,
    requests: inPhase.length,
    throughputPerSecond: Number((inPhase.length / seconds).toFixed(1)),
    errors: inPhase.filter((s) => s.status >= 500 || s.status === 0).length,
    overall: { p50: Math.round(percentile(all, 50)), p95: Math.round(percentile(all, 95)), p99: Math.round(percentile(all, 99)), max: Math.round(all[all.length - 1] ?? 0) },
    endpoints: rows,
  };
}

async function datasetCounts() {
  const client = new pg.Client({ connectionString: capacityUrls().migrator });
  await client.connect();
  try {
    const { rows } = await client.query(`
      SELECT (SELECT count(*)::int FROM users) AS users, (SELECT count(*)::int FROM opportunities) AS opportunities,
             (SELECT count(*)::int FROM activities) AS activities, (SELECT count(*)::int FROM follow_ups) AS follow_ups,
             (SELECT count(*)::int FROM audit_events) AS audit_events, (SELECT version()) AS postgres`);
    return rows[0] as Record<string, unknown>;
  } finally {
    await client.end();
  }
}

/** The hourly notification scan over the whole dataset, timed (FR-090, NFR-003). */
async function timeNotificationScan() {
  const database = createDatabase(capacityUrls().runtime);
  try {
    const started = performance.now();
    const result = await runNotificationScan(database.db);
    const ms = Math.round(performance.now() - started);
    const { rows } = await database.pool.query(
      `SELECT count(*)::int AS alerts, count(DISTINCT recipient_id)::int AS recipients FROM notifications WHERE resolved_at IS NULL`,
    );
    return { ms, ...result, ...(rows[0] as Record<string, number>) };
  } finally {
    await database.close();
  }
}

async function main(): Promise<void> {
  const scan = await timeNotificationScan();
  console.log(`Notification scan: ${JSON.stringify(scan)}`);
  const server = spawn(process.execPath, ['--import', 'tsx', path.join('scripts', 'capacity', 'server.ts')], {
    env: { ...process.env, CAPACITY_PORT: String(PORT), CAPACITY_ORIGIN: ORIGIN },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverOutput = '';
  server.stdout.on('data', (chunk: Buffer) => (serverOutput += chunk.toString()));
  server.stderr.on('data', (chunk: Buffer) => (serverOutput += chunk.toString()));
  try {
    const deadline = Date.now() + 30_000;
    while (!serverOutput.includes('listening')) {
      if (Date.now() > deadline || server.exitCode !== null) throw new Error(`Capacity API did not start:\n${serverOutput}`);
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    const emails = [
      ...[1, 2, 3].map((m) => `cap.management.${m}@example.com`),
      ...[1, 2, 3, 4, 5, 6].map((n) => `cap.lead.${n}@example.com`),
      ...Array.from({ length: 21 }, (_, i) => `cap.sales.${1 + (i % 8)}.${1 + Math.floor(i / 8)}@example.com`),
    ];
    const users: UserState[] = [];
    for (const email of emails) {
      const client = new Client(email);
      const started = performance.now();
      await client.signIn();
      samples.push({ phase: 'sign-in', label: 'POST /api/auth/login (with CSRF bootstrap)', ms: performance.now() - started, status: 200 });
      users.push({ client, opportunityIds: [], role: email.split('.')[1]! });
    }

    // Warm-up: fill each user's id cache and the database cache, unmeasured.
    phase = 'warm-up';
    await Promise.all(users.map((user) => steps[1]![2](user)));

    console.log(`Paced phase: ${PACED_SECONDS} s, 30 users, 1–3 s between requests…`);
    await runPhase(users, 'paced', PACED_SECONDS, [1_000, 3_000]);
    console.log(`Saturation phase: ${SATURATION_SECONDS} s, 30 users, no waiting…`);
    await runPhase(users, 'saturation', SATURATION_SECONDS, [0, 0]);

    const signIns = samples.filter((s) => s.phase === 'sign-in').map((s) => s.ms).sort((a, b) => a - b);
    const result = {
      measuredAt: new Date().toISOString(),
      machine: {
        cpu: os.cpus()[0]?.model,
        logicalCpus: os.cpus().length,
        memoryGb: Math.round(os.totalmem() / 1024 ** 3),
        os: `${os.type()} ${os.release()}`,
        node: process.version,
        note: 'API, PostgreSQL (Docker Desktop) and the load generator on the same laptop; loopback network.',
      },
      dataset: await datasetCounts(),
      users: { total: users.length, management: 3, leads: 6, salespeople: 21 },
      targetP95Ms: TARGET_P95_MS,
      notificationScan: scan,
      signIn: { count: signIns.length, p50: Math.round(percentile(signIns, 50)), p95: Math.round(percentile(signIns, 95)), max: Math.round(signIns.at(-1) ?? 0) },
      phases: [summarise('paced', PACED_SECONDS), summarise('saturation', SATURATION_SECONDS)],
    };

    const dir = path.join('docs', 'evidence', 'capacity');
    mkdirSync(dir, { recursive: true });
    const stamp = process.env.CAPACITY_LABEL ?? 'latest';
    writeFileSync(path.join(dir, `load-${stamp}.json`), `${JSON.stringify(result, null, 2)}\n`);
    writeFileSync(path.join(dir, `load-${stamp}.md`), toMarkdown(result));
    console.log(toMarkdown(result));
  } finally {
    server.kill();
  }
}

function toMarkdown(result: {
  measuredAt: string;
  machine: Record<string, unknown>;
  dataset: Record<string, unknown>;
  targetP95Ms: number;
  signIn: Record<string, number>;
  notificationScan: Record<string, number>;
  phases: ReturnType<typeof summarise>[];
}): string {
  const lines = [
    `# Capacity load test — ${result.measuredAt}`,
    '',
    `Machine: ${result.machine.cpu} (${result.machine.logicalCpus} logical CPUs), ${result.machine.memoryGb} GB, ${result.machine.os}, Node ${result.machine.node}. ${result.machine.note}`,
    '',
    `Dataset: ${JSON.stringify(result.dataset)}`,
    '',
    `Notification scan before the run (whole dataset): ${result.notificationScan.ms} ms, ${result.notificationScan.alerts} open alerts for ${result.notificationScan.recipients} recipients.`,
    '',
    `Sign-in (argon2id, 30 users, sequential): p50 ${result.signIn.p50} ms, p95 ${result.signIn.p95} ms, max ${result.signIn.max} ms.`,
    '',
  ];
  for (const phaseResult of result.phases) {
    lines.push(
      `## ${phaseResult.phase} — ${phaseResult.requests} requests in ${phaseResult.seconds} s (${phaseResult.throughputPerSecond}/s), ${phaseResult.errors} server errors`,
      '',
      `Overall: p50 ${phaseResult.overall.p50} ms · **p95 ${phaseResult.overall.p95} ms** · p99 ${phaseResult.overall.p99} ms · max ${phaseResult.overall.max} ms (target p95 < ${result.targetP95Ms} ms)`,
      '',
      '| Endpoint | n | p50 | p95 | p99 | max | 5xx | 4xx (not 409) |',
      '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
      ...phaseResult.endpoints.map((row) => `| ${row.label} | ${row.count} | ${row.p50} | ${row.p95} | ${row.p99} | ${row.max} | ${row.errors} | ${row.unexpected4xx} |`),
      '',
    );
  }
  return `${lines.join('\n')}\n`;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
