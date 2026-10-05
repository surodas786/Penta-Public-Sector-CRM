/**
 * Server configuration. Fails fast and loudly rather than starting with an
 * unsafe or half-configured environment (plan 4.4).
 */

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
}

/**
 * SEC-010 document storage and scanning. Production infrastructure has not
 * been chosen (see ADR 0006): the only storage is a private local directory,
 * and the only scanner is a deterministic test scanner that is refused in
 * production. With no scanner, files are stored but stay unavailable.
 */
export type DocumentScannerKind = 'none' | 'test';

export interface DocumentConfig {
  /** Private directory outside anything the web server serves. */
  storageDir: string;
  scanner: DocumentScannerKind;
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

function readScanner(isProduction: boolean): DocumentScannerKind {
  const raw = (process.env.DOCUMENT_SCANNER ?? 'none').trim();
  if (raw !== 'none' && raw !== 'test') {
    throw new Error(`DOCUMENT_SCANNER must be none or test, received "${raw}".`);
  }
  // The test scanner recognises test fixtures only. It is not malware scanning.
  if (raw === 'test' && isProduction) {
    throw new Error('DOCUMENT_SCANNER=test is a development scanner and must not be used in production.');
  }
  return raw;
}

function readNodeEnv(): AppEnvironment {
  const raw = (process.env.NODE_ENV ?? 'development').trim();
  if (raw === 'development' || raw === 'test' || raw === 'production') return raw;
  throw new Error(`NODE_ENV must be development, test or production, received "${raw}".`);
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
      scanner: readScanner(isProduction),
      maxUploadBytes: positiveInt('DOCUMENT_MAX_UPLOAD_MB', 25) * 1024 * 1024,
      uploadTtlMinutes: positiveInt('DOCUMENT_UPLOAD_TTL_MINUTES', 60),
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
