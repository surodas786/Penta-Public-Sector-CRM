/**
 * The ClamAV adapter's side of the clamd INSTREAM protocol (SEC-010, ADR 0006).
 *
 * The daemon here is a minimal stand-in that speaks the wire protocol, so the
 * adapter's framing, verdict parsing and outage handling are checked without
 * a signature database. `npm run ops:check-scanner` checks a real daemon.
 */
import net from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  ClamAvScanner,
  EICAR_SIGNATURE,
  ScannerUnreachableError,
  createScanner,
  parseClamdReply,
} from '../documents/scanner.js';

type Behaviour = 'verdict' | 'stall' | 'close';

/** Reassembles one INSTREAM upload and answers the way clamd does. */
function fakeClamd(behaviour: () => Behaviour) {
  const received: Buffer[] = [];
  const server = net.createServer((socket) => {
    let buffer = Buffer.alloc(0);
    let commandRead = false;
    socket.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (!commandRead) {
        const end = buffer.indexOf(0);
        if (end < 0) return;
        expect(buffer.subarray(0, end).toString()).toBe('zINSTREAM');
        buffer = buffer.subarray(end + 1);
        commandRead = true;
      }
      const parts: Buffer[] = [];
      let offset = 0;
      while (buffer.length - offset >= 4) {
        const length = buffer.readUInt32BE(offset);
        if (length === 0) {
          const content = Buffer.concat(parts);
          received.push(content);
          const mode = behaviour();
          if (mode === 'stall') return;
          if (mode === 'close') {
            socket.destroy();
            return;
          }
          const reply = content.includes(EICAR_SIGNATURE)
            ? 'stream: Win.Test.EICAR_HDB-1 FOUND'
            : content.includes('TOO-BIG')
              ? 'INSTREAM size limit exceeded. ERROR'
              : 'stream: OK';
          socket.end(`${reply}\0`);
          return;
        }
        if (buffer.length - offset - 4 < length) return;
        parts.push(buffer.subarray(offset + 4, offset + 4 + length));
        offset += 4 + length;
      }
    });
  });
  return { server, received };
}

describe('ClamAV scanner adapter', () => {
  let mode: Behaviour = 'verdict';
  const clamd = fakeClamd(() => mode);
  let port = 0;

  beforeAll(async () => {
    await new Promise<void>((resolve) => clamd.server.listen(0, '127.0.0.1', resolve));
    port = (clamd.server.address() as net.AddressInfo).port;
  });
  afterAll(() => new Promise<void>((resolve) => clamd.server.close(() => resolve())));

  const scanner = () => new ClamAvScanner({ host: '127.0.0.1', port, timeoutMs: 2000 });

  it('streams the whole file in length-prefixed chunks and reports a clean verdict', async () => {
    mode = 'verdict';
    const content = Buffer.alloc(200 * 1024 + 17, 'a');
    await expect(scanner().scan(content)).resolves.toEqual({ verdict: 'clean' });
    expect(clamd.received.at(-1)?.equals(content)).toBe(true);
  });

  it('reports the signature of an infected file', async () => {
    mode = 'verdict';
    await expect(scanner().scan(Buffer.from(EICAR_SIGNATURE))).resolves.toEqual({
      verdict: 'infected',
      detail: 'Win.Test.EICAR_HDB-1',
    });
  });

  it('throws, never reports clean, when clamd answers with an error', async () => {
    mode = 'verdict';
    const error = await scanner().scan(Buffer.from('TOO-BIG')).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(ScannerUnreachableError);
    expect((error as Error).message).toMatch(/size limit exceeded/);
  });

  it('throws when clamd closes the connection without a verdict', async () => {
    mode = 'close';
    const error = await scanner().scan(Buffer.from('hello')).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(ScannerUnreachableError);
  });

  it('treats a daemon that does not answer in time as unreachable', async () => {
    mode = 'stall';
    const slow = new ClamAvScanner({ host: '127.0.0.1', port, timeoutMs: 300 });
    await expect(slow.scan(Buffer.from('hello'))).rejects.toBeInstanceOf(ScannerUnreachableError);
  });

  it('treats a refused connection as unreachable', async () => {
    const closed = net.createServer();
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
    const unusedPort = (closed.address() as net.AddressInfo).port;
    await new Promise<void>((resolve) => closed.close(() => resolve()));
    const down = new ClamAvScanner({ host: '127.0.0.1', port: unusedPort, timeoutMs: 2000 });
    await expect(down.scan(Buffer.from('hello'))).rejects.toBeInstanceOf(ScannerUnreachableError);
  });

  it('parses clamd replies, with or without a session id', () => {
    expect(parseClamdReply('stream: OK')).toEqual({ verdict: 'clean' });
    expect(parseClamdReply('1: stream: OK')).toEqual({ verdict: 'clean' });
    expect(parseClamdReply('stream: Eicar-Signature FOUND')).toEqual({ verdict: 'infected', detail: 'Eicar-Signature' });
    expect(() => parseClamdReply('')).toThrow();
    expect(() => parseClamdReply('UNKNOWN COMMAND')).toThrow();
  });

  it('is built from the document configuration', () => {
    const built = createScanner({
      storageDir: '.',
      scanner: 'clamav',
      clamav: { host: '127.0.0.1', port: 3310, timeoutMs: 1000 },
      maxUploadBytes: 1,
      uploadTtlMinutes: 1,
    });
    expect(built.name).toBe('clamav');
    expect(built.available).toBe(true);
  });
});
