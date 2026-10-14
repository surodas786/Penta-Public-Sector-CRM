/**
 * Server configuration. Fails fast and loudly rather than starting with an
 * unsafe or half-configured environment (plan 4.4).
 */

import type { EmailTransportKind } from '../shared/email.js';

export type AppEnvironment = 'development' | 'test' | 'production';

export interface ServerConfig {
  nodeEnv: AppEnvironment;
  isProduction: boolean;
  port: number;
  /** Bind address. Loopback in development; set explicitly in production. */
  host: string;
  appOrigin: string;
  databaseUrl: string;
  sessionSecret: string;
  csrfSecret: string;
  sessionIdleMinutes: number;
  sessionAbsoluteMinutes: number;
  /** HTTPS-only cookies. Forced on in production. */
  secureCookies: boolean;
  documents: DocumentConfig;
  jobs: JobsConfig;
  email: EmailConfig;
  /** REQUEST_LOG: one summary line per request (`all`), per failed or slow request (`errors`, default), or none. */
  requestLog: 'all' | 'errors' | 'off';
}

/**
 * Background work (FR-090, NFR-003): notification scans, queued CSV exports
 * and housekeeping, all through the durable `background_jobs` queue.
 */
export interface JobsConfig {
  /** Run the worker inside the API process. Off for the integration suite, which drives jobs itself. */
  enabled: boolean;
  /** How often the worker looks for due work. */
  pollSeconds: number;
  /** A ready export can be downloaded for this long, then it is removed. */
  exportTtlHours: number;
  /** An export reaching this many rows is refused rather than truncated (FR-083: all matching rows). */
  exportMaxRows: number;
}

/**
 * How this server sends email (CR2). The mail server itself (host, sender,
 * credentials) is configured by an administrator in the application; these
 * settings decide whether and how this deployment may send at all.
 *
 *   none     nothing is sent; queued emails are marked suppressed
 *   capture  development and tests: messages are written to EMAIL_CAPTURE_DIR
 *            and never leave the machine. Refused in production.
 *   smtp     the administrator's mail server is used
 */
export interface EmailConfig {
  transport: EmailTransportKind;
  /** 32-byte key for the SMTP password at rest (EMAIL_SECRET_KEY, 64 hex). Null: no password can be stored. */
  secretKey: Buffer | null;
  captureDir: string;
  /** Upper bound for one SMTP conversation. */
  sendTimeoutMs: number;
}

/**
 * SEC-010 document storage and scanning (ADR 0006). Storage is a private
 * local directory. Scanners: none (files are stored but stay unavailable),
 * test (a deterministic development scanner, refused in production) and
 * clamav (a ClamAV daemon reached over TCP).
 */
export type DocumentScannerKind = 'none' | 'test' | 'clamav';

export interface ClamAvConfig {
  host: string;
  port: number;
  /** Upper bound for one scan, connection included. */
  timeoutMs: number;
}

export interface DocumentConfig {
  /** Private directory outside anything the web server serves. */
  storageDir: string;
  scanner: DocumentScannerKind;
  /** Present when, and only when, scanner is clamav. */
  clamav?: ClamAvConfig;
  maxUploadBytes: number;
  /** An upload not finalized within this time is abandoned and removed. */
  uploadTtlMinutes: number;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(
      `Missing required environment variable ${name}. Copy .env.example to .env and fill it in.`,
    );
  }
  return value.trim();
}

function positiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive whole number, received "${raw}".`);
  }
  return parsed;
}

function readBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new Error(`${name} must be true or false, received "${raw}".`);
}

function readScanner(isProduction: boolean): DocumentScannerKind {
  const raw = (process.env.DOCUMENT_SCANNER ?? 'none').trim();
  if (raw !== 'none' && raw !== 'test' && raw !== 'clamav') {
    throw new Error(`DOCUMENT_SCANNER must be none, test or clamav, received "${raw}".`);
  }
  // The test scanner recognises test fixtures only. It is not malware scanning.
  if (raw === 'test' && isProduction) {
    throw new Error('DOCUMENT_SCANNER=test is a development scanner and must not be used in production.');
  }
  return raw;
}

function readClamAv(scanner: DocumentScannerKind): ClamAvConfig | undefined {
  if (scanner !== 'clamav') return undefined;
  return {
    host: (process.env.CLAMAV_HOST ?? '127.0.0.1').trim(),
    port: positiveInt('CLAMAV_PORT', 3310),
    timeoutMs: positiveInt('CLAMAV_TIMEOUT_SECONDS', 60) * 1000,
  };
}

function readEmailTransport(isProduction: boolean): EmailTransportKind {
  const raw = (process.env.EMAIL_TRANSPORT ?? (isProduction ? 'none' : 'capture')).trim();
  if (raw !== 'none' && raw !== 'capture' && raw !== 'smtp') {
    throw new Error(`EMAIL_TRANSPORT must be none, capture or smtp, received "${raw}".`);
  }
  // Capture writes messages to a local folder for development. In production
  // that would silently lose real email.
  if (raw === 'capture' && isProduction) {
    throw new Error('EMAIL_TRANSPORT=capture is for development and tests and must not be used in production.');
  }
  return raw;
}

function readEmailSecretKey(): Buffer | null {
  const raw = process.env.EMAIL_SECRET_KEY?.trim();
  if (!raw) return null;
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error('EMAIL_SECRET_KEY must be 64 hexadecimal characters (32 random bytes).');
  }
  return Buffer.from(raw, 'hex');
}

function readNodeEnv(): AppEnvironment {
  const raw = (process.env.NODE_ENV ?? 'development').trim();
  if (raw === 'development' || raw === 'test' || raw === 'production') return raw;
  throw new Error(`NODE_ENV must be development, test or production, received "${raw}".`);
}

function readRequestLog(): ServerConfig['requestLog'] {
  const raw = (process.env.REQUEST_LOG ?? 'errors').trim();
  if (raw === 'all' || raw === 'errors' || raw === 'off') return raw;
  throw new Error(`REQUEST_LOG must be all, errors or off, received "${raw}".`);
}

/** Obviously-unsafe placeholder secrets must not reach production. */
const PLACEHOLDER_SECRETS = new Set([
  'replace-me-with-a-32-byte-random-hex-value',
  'replace-me-with-a-different-32-byte-random-hex-value',
  'changeme',
  'secret',
]);

export function loadServerConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  const nodeEnv = readNodeEnv();
  const isProduction = nodeEnv === 'production';

  const sessionSecret = required('SESSION_SECRET');
  const csrfSecret = required('CSRF_SECRET');

  if (isProduction) {
    for (const [name, value] of [
      ['SESSION_SECRET', sessionSecret],
      ['CSRF_SECRET', csrfSecret],
    ] as const) {
      if (PLACEHOLDER_SECRETS.has(value) || value.length < 32) {
        throw new Error(`${name} is a placeholder or too short for production use.`);
      }
    }
    // NFR-001: a production server must never register demo endpoints or seeds.
    if (process.env.VITE_DEMO_MODE === 'true') {
      throw new Error('VITE_DEMO_MODE must not be enabled in production.');
    }
    if (process.env.ALLOW_DEMO_ENDPOINTS === 'true') {
      throw new Error('ALLOW_DEMO_ENDPOINTS must not be enabled in production.');
    }
  }

  const scanner = readScanner(isProduction);
  const config: ServerConfig = {
    nodeEnv,
    isProduction,
    port: positiveInt('PORT', 4800),
    // Explicit so the server does not depend on the platform's IPv4/IPv6
    // default: Node binds the IPv6 loopback on some systems, which makes a
    // 127.0.0.1 health probe fail against an otherwise healthy server.
    host: (process.env.HOST ?? (isProduction ? '0.0.0.0' : '127.0.0.1')).trim(),
    appOrigin: (process.env.APP_ORIGIN ?? 'http://localhost:5173').trim().replace(/\/$/, ''),
    // May be supplied by an override instead of the environment, which is how
    // the integration harness points the app at the test database without
    // rewriting DATABASE_URL (and so without defeating its own safety check).
    databaseUrl: (process.env.DATABASE_URL ?? '').trim(),
    sessionSecret,
    csrfSecret,
    sessionIdleMinutes: positiveInt('SESSION_IDLE_MINUTES', 30),
    sessionAbsoluteMinutes: positiveInt('SESSION_ABSOLUTE_MINUTES', 720),
    secureCookies: isProduction || process.env.FORCE_SECURE_COOKIES === 'true',
    documents: {
      storageDir: (process.env.DOCUMENT_STORAGE_DIR ?? './var/documents').trim(),
      scanner,
      clamav: readClamAv(scanner),
      maxUploadBytes: positiveInt('DOCUMENT_MAX_UPLOAD_MB', 25) * 1024 * 1024,
      uploadTtlMinutes: positiveInt('DOCUMENT_UPLOAD_TTL_MINUTES', 60),
    },
    jobs: {
      enabled: readBoolean('JOBS_ENABLED', true),
      pollSeconds: positiveInt('JOBS_POLL_SECONDS', 15),
      exportTtlHours: positiveInt('REPORT_EXPORT_TTL_HOURS', 24),
      exportMaxRows: positiveInt('REPORT_EXPORT_MAX_ROWS', 50_000),
    },
    requestLog: readRequestLog(),
    email: {
      transport: readEmailTransport(isProduction),
      secretKey: readEmailSecretKey(),
      captureDir: (process.env.EMAIL_CAPTURE_DIR ?? './var/mail-outbox').trim(),
      sendTimeoutMs: positiveInt('EMAIL_SEND_TIMEOUT_SECONDS', 20) * 1000,
    },
    ...overrides,
  };

  if (!config.databaseUrl) {
    throw new Error(
      'No database connection configured. Set DATABASE_URL (copy .env.example to .env) ' +
        'or pass a databaseUrl override.',
    );
  }

  return config;
}

/**
 * Resolves the database the integration suite may use.
 *
 * Plan 7.6: the harness must reject production execution, missing test
 * configuration, and a test URL that actually points at the development
 * database.
 */
export function resolveTestDatabaseUrl(): string {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to run the test suite with NODE_ENV=production.');
  }

  const testUrl = process.env.TEST_DATABASE_URL?.trim();
  if (!testUrl) {
    throw new Error(
      'TEST_DATABASE_URL is not set. The integration suite requires its own database; ' +
        'see .env.example.',
    );
  }

  const devUrl = process.env.DATABASE_URL?.trim();
  if (devUrl && sameDatabase(testUrl, devUrl)) {
    throw new Error(
      'TEST_DATABASE_URL points at the same database as DATABASE_URL. ' +
        'The suite truncates tables and must never run against the development database.',
    );
  }

  return testUrl;
}

/**
 * Loopback spellings that all reach the same server. Without this, writing one
 * URL as `localhost` and the other as `127.0.0.1` would slip past the guard.
 */
const LOOPBACK_ALIASES = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0']);

function normaliseHost(hostname: string): string {
  const lower = hostname.toLowerCase();
  return LOOPBACK_ALIASES.has(lower) ? 'localhost' : lower;
}

/** Compares host, port and database name; credentials and query flags are ignored. */
export function sameDatabase(a: string, b: string): boolean {
  try {
    const left = new URL(a);
    const right = new URL(b);
    return (
      normaliseHost(left.hostname) === normaliseHost(right.hostname) &&
      (left.port || '5432') === (right.port || '5432') &&
      left.pathname === right.pathname
    );
  } catch {
    return a === b;
  }
}
