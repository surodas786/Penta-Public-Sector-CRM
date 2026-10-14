/**
 * Checks the ClamAV daemon the API will use (SEC-010, ADR 0006), from the
 * same host and with the same settings: it must report a harmless text file
 * clean and the EICAR anti-malware test file infected. Writes nothing to
 * disk or the database.
 *
 *   npm run ops:check-scanner
 *
 * Reads CLAMAV_HOST, CLAMAV_PORT and CLAMAV_TIMEOUT_SECONDS from the
 * environment or .env. Exits non-zero if either verdict is wrong.
 */
import { ClamAvScanner, EICAR_SIGNATURE } from '../../server/documents/scanner.js';

try {
  process.loadEnvFile('.env');
} catch {
  // The environment may be provided directly.
}

const host = (process.env.CLAMAV_HOST ?? '127.0.0.1').trim();
const port = Number(process.env.CLAMAV_PORT ?? 3310);
const timeoutMs = Number(process.env.CLAMAV_TIMEOUT_SECONDS ?? 60) * 1000;

async function main(): Promise<void> {
  if (process.env.DOCUMENT_SCANNER?.trim() !== 'clamav') {
    console.warn(`Note: DOCUMENT_SCANNER is "${process.env.DOCUMENT_SCANNER ?? '(unset)'}", not clamav. Checking the daemon anyway.`);
  }
  const scanner = new ClamAvScanner({ host, port, timeoutMs });
  console.log(`Checking clamd at ${host}:${port}…`);

  const clean = await scanner.scan(Buffer.from('Penta CRM scanner check: an ordinary text file.\n'));
  const eicar = await scanner.scan(Buffer.from(EICAR_SIGNATURE));

  const cleanOk = clean.verdict === 'clean';
  const eicarOk = eicar.verdict === 'infected';
  console.log(`  ordinary file: ${clean.verdict}${cleanOk ? '' : '  <-- expected clean'}`);
  console.log(`  EICAR test file: ${eicar.verdict}${eicar.verdict === 'infected' ? ` (${eicar.detail})` : '  <-- expected infected'}`);

  if (!cleanOk || !eicarOk) {
    console.error('Scanner check FAILED.');
    process.exit(1);
  }
  console.log('Scanner check passed.');
}

main().catch((error: unknown) => {
  console.error('Scanner check FAILED:', error instanceof Error ? error.message : error);
  process.exit(1);
});
