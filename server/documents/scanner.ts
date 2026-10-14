/**
 * Malware scanning before availability (SEC-010, ADR 0006).
 *
 *   none          The default. Reports itself unavailable, so files stay
 *                 `pending` and can never be downloaded.
 *   test-scanner  Development and tests only, refused in production by
 *                 server/env.ts. It flags the industry-standard EICAR test
 *                 string, and fails on a marker so scanner failures can be
 *                 exercised. It does NOT detect malware. Its verdicts are
 *                 stored with its name so they are never mistaken for real
 *                 scanning.
 *   clamav        A ClamAV daemon (clamd), sent each file over TCP with the
 *                 INSTREAM command. The file never touches the daemon's disk.
 */
import net from 'node:net';

import type { ClamAvConfig, DocumentConfig } from '../env.js';

export type ScanVerdict = { verdict: 'clean' } | { verdict: 'infected'; detail: string };

export interface DocumentScanner {
  /** Recorded with every verdict. */
  readonly name: string;
  /** False when no scanner is configured: files must stay unavailable. */
  readonly available: boolean;
  /**
   * Throws when the scanner cannot decide; the file is then marked `failed`.
   * Throws ScannerUnreachableError when the scanner itself is down; the file
   * then stays `pending` and is retried by document maintenance.
   */
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

/** The scanner could not be reached or did not answer: say nothing about the file. */
export class ScannerUnreachableError extends Error {
  override readonly name = 'ScannerUnreachableError';
}

export const CLAMAV_SCANNER_NAME = 'clamav';

/** clamd accepts INSTREAM data in chunks, each prefixed by its length. */
const CLAMD_CHUNK_BYTES = 64 * 1024;

export class ClamAvScanner implements DocumentScanner {
  readonly name = CLAMAV_SCANNER_NAME;
  readonly available = true;

  constructor(private readonly config: ClamAvConfig) {}

  async scan(content: Buffer): Promise<ScanVerdict> {
    return parseClamdReply(await clamdInstream(this.config, content));
  }
}

/**
 * Reads a clamd INSTREAM reply: "stream: OK", "stream: <signature> FOUND" or
 * "<reason> ERROR" (for example a file over clamd's StreamMaxLength). Anything
 * that is not a verdict throws, so the file is marked failed, never clean.
 */
export function parseClamdReply(reply: string): ScanVerdict {
  const body = reply.trim().replace(/^(?:\d+: )?stream: /, '');
  if (body === 'OK') return { verdict: 'clean' };
  const found = /^(.+) FOUND$/.exec(body);
  if (found?.[1]) return { verdict: 'infected', detail: found[1] };
  throw new Error(`ClamAV could not scan the file: ${body.slice(0, 200)}`);
}

function clamdInstream(config: ClamAvConfig, content: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const received: Buffer[] = [];
    let connected = false;
    let settled = false;

    const socket = net.createConnection({ host: config.host, port: config.port });
    const finish = (error: Error | null, reply?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolve(reply ?? '');
    };
    // A whole-scan bound, not an idle timeout: a stalled daemon must not hold
    // the scan forever. Treated as an outage, so the file is retried later.
    const timer = setTimeout(
      () => finish(new ScannerUnreachableError(`ClamAV did not answer within ${config.timeoutMs / 1000} seconds.`)),
      config.timeoutMs,
    );
    const replyText = () => Buffer.concat(received).toString('utf8').replace(/\0+$/, '');

    socket.on('connect', () => {
      connected = true;
      socket.write('zINSTREAM\0');
      for (let offset = 0; offset < content.length; offset += CLAMD_CHUNK_BYTES) {
        const chunk = content.subarray(offset, offset + CLAMD_CHUNK_BYTES);
        const length = Buffer.alloc(4);
        length.writeUInt32BE(chunk.length);
        socket.write(length);
        socket.write(chunk);
      }
      socket.write(Buffer.alloc(4));
    });
    socket.on('data', (chunk: Buffer) => {
      received.push(chunk);
      if (chunk.includes(0)) finish(null, replyText());
    });
    socket.on('error', (error: NodeJS.ErrnoException) => {
      if (!connected) {
        finish(new ScannerUnreachableError(`ClamAV at ${config.host}:${config.port} is unreachable (${error.code ?? error.message}).`));
      } else if (received.length > 0) {
        // clamd may answer (e.g. size limit exceeded) and close while data is still being sent.
        finish(null, replyText());
      } else {
        finish(new Error(`ClamAV connection failed during the scan (${error.code ?? error.message}).`));
      }
    });
    socket.on('close', () => {
      if (received.length > 0) finish(null, replyText());
      else finish(new Error('ClamAV closed the connection without a verdict.'));
    });
  });
}

export function createScanner(config: DocumentConfig): DocumentScanner {
  if (config.scanner === 'test') return new TestScanner();
  if (config.scanner === 'clamav') {
    if (!config.clamav) throw new Error('DOCUMENT_SCANNER=clamav needs its ClamAV settings.');
    return new ClamAvScanner(config.clamav);
  }
  return new UnavailableScanner();
}
