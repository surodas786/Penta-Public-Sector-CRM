/**
 * Malware scanning before availability (SEC-010).
 *
 * No production scanner has been chosen (ADR 0006). Two adapters exist:
 *
 *   none          The default. Reports itself unavailable, so files stay
 *                 `pending` and can never be downloaded.
 *   test-scanner  Development and tests only, refused in production by
 *                 server/env.ts. It flags the industry-standard EICAR test
 *                 string, and fails on a marker so scanner failures can be
 *                 exercised. It does NOT detect malware. Its verdicts are
 *                 stored with its name so they are never mistaken for real
 *                 scanning.
 */
import type { DocumentScannerKind } from '../env.js';

export type ScanVerdict = { verdict: 'clean' } | { verdict: 'infected'; detail: string };

export interface DocumentScanner {
  /** Recorded with every verdict. */
  readonly name: string;
  /** False when no scanner is configured: files must stay unavailable. */
  readonly available: boolean;
  /** Throws when the scanner cannot decide; the file is then marked `failed`. */
  scan(content: Buffer): Promise<ScanVerdict>;
}

/**
 * The EICAR anti-malware test file signature. Harmless by design. Assembled at
 * runtime so this source file is not itself flagged by a workstation scanner.
 */
export const EICAR_SIGNATURE = ['X5O!P%@AP[4\\PZX54(P^)7CC)7}$', 'EICAR-STANDARD-ANTIVIRUS-', 'TEST-FILE!$H+H*'].join('');

/** Makes the test scanner throw, to exercise the `failed` path. */
export const TEST_SCANNER_FAILURE_MARKER = 'PENTA-TEST-SCANNER-FAILURE';

export const TEST_SCANNER_NAME = 'test-scanner';

export class UnavailableScanner implements DocumentScanner {
  readonly name = 'none';
  readonly available = false;
  scan(): Promise<ScanVerdict> {
    return Promise.reject(new Error('No document scanner is configured.'));
  }
}

export class TestScanner implements DocumentScanner {
  readonly name = TEST_SCANNER_NAME;
  readonly available = true;

  scan(content: Buffer): Promise<ScanVerdict> {
    if (content.includes(TEST_SCANNER_FAILURE_MARKER)) {
      return Promise.reject(new Error('Test scanner failure requested by marker.'));
    }
    if (content.includes(EICAR_SIGNATURE)) {
      return Promise.resolve({ verdict: 'infected', detail: 'EICAR test signature' });
    }
    return Promise.resolve({ verdict: 'clean' });
  }
}

export function createScanner(kind: DocumentScannerKind): DocumentScanner {
  return kind === 'test' ? new TestScanner() : new UnavailableScanner();
}
