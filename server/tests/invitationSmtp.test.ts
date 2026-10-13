/**
 * CR1 over real SMTP: an invitation travels through the SMTP transport to a
 * local mail sink (a minimal SMTP server on 127.0.0.1, so nothing leaves the
 * machine), arrives at the new user's address with a working link, and is
 * never shown to the administrator.
 *
 * Also pins down when the copy-link fallback is used instead: while "Send
 * email from the CRM" is off, even though a test message still goes out.
 */
import net from 'node:net';

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { emailDeliveries, emailSettings } from '../db/schema.js';
import { createEmailRuntime } from '../email/runtime.js';
import { createJobHandlers } from '../jobs/handlers.js';
import { runDueJobs } from '../jobs/queue.js';
import { CSRF_HEADER, TEST_ORIGIN, createTestApp, emails, ids, resetFixtures, send, signIn, startSession, type TestContext } from './helpers/harness.js';

interface SunkMessage {
  from: string;
  to: string[];
  data: string;
}

/** Just enough SMTP to receive messages: no TLS, no sign-in. */
function startSmtpSink(): Promise<{ port: number; messages: SunkMessage[]; close: () => Promise<void> }> {
  const messages: SunkMessage[] = [];
  const server = net.createServer((socket) => {
    let buffer = '';
    let inData = false;
    let current: SunkMessage = { from: '', to: [], data: '' };
    socket.write('220 sink.local ESMTP\r\n');
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let end: number;
      while ((end = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (inData) {
          if (line === '.') {
            inData = false;
            messages.push(current);
            current = { from: '', to: [], data: '' };
            socket.write('250 Queued\r\n');
          } else {
            current.data += `${line.startsWith('..') ? line.slice(1) : line}\n`;
          }
          continue;
        }
        const command = line.slice(0, 4).toUpperCase();
        if (command === 'EHLO') socket.write('250-sink.local\r\n250 8BITMIME\r\n');
        else if (command === 'MAIL') {
          current.from = line.slice(10).trim();
          socket.write('250 OK\r\n');
        } else if (command === 'RCPT') {
          current.to.push(line.slice(8).trim());
          socket.write('250 OK\r\n');
        } else if (command === 'DATA') {
          inData = true;
          socket.write('354 End data with <CR><LF>.<CR><LF>\r\n');
        } else if (command === 'QUIT') {
          socket.end('221 Bye\r\n');
        } else socket.write('250 OK\r\n');
      }
    });
    socket.on('error', () => undefined);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as net.AddressInfo).port;
      resolve({ port, messages, close: () => new Promise<void>((done) => server.close(() => done())) });
    });
  });
}

/** Undoes quoted-printable soft breaks and escapes, so a link can be read whole. */
function decodeQuotedPrintable(text: string): string {
  return text.replace(/=\n/g, '').replace(/=([0-9A-F]{2})/g, (_whole, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

describe('CR1: invitations over SMTP', () => {
  let ctx: TestContext;
  let sink: Awaited<ReturnType<typeof startSmtpSink>>;

  beforeAll(async () => {
    sink = await startSmtpSink();
    ctx = createTestApp({ email: { transport: 'smtp', sendTimeoutMs: 5_000 } });
  });
  afterAll(async () => {
    await ctx.close();
    await sink.close();
  });
  beforeEach(async () => {
    await resetFixtures();
    sink.messages.length = 0;
  });

  const runJobs = () =>
    runDueJobs(ctx.database.db, createJobHandlers(ctx.database.db, { exportTtlHours: 24, exportMaxRows: 50_000 }, createEmailRuntime(ctx.config)));

  async function configure(enabled: boolean) {
    await ctx.database.db
      .insert(emailSettings)
      .values({ id: 1, enabled, host: '127.0.0.1', port: sink.port, security: 'none', fromName: 'Penta Info', fromAddress: 'info@example.test' });
  }

  it('emails the invitation to the new user’s address while delivery is on, and the link works', async () => {
    await configure(true);
    const admin = await signIn(ctx.app, emails.admin);
    const created = await send(admin, '/api/admin/users', {
      fullName: 'Milton Test',
      email: 'milton.test@example.test',
      role: 'sales',
      sectionIds: [ids.sectionGA],
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    // Emailed, so the administrator is never shown a link.
    expect(created.body.link).toBeNull();
    expect(created.body.delivery).toBe('email');

    await runJobs();
    expect(sink.messages).toHaveLength(1);
    const [message] = sink.messages;
    expect(message!.to).toEqual(['<milton.test@example.test>']);
    expect(message!.from).toBe('<info@example.test>');
    const body = decodeQuotedPrintable(message!.data);
    expect(body).toMatch(/^Subject: Your Penta CRM account$/m);
    const token = body.match(/\/set-password#token=([\w-]+)/)?.[1];
    expect(token).toBeTruthy();

    const [delivery] = await ctx.database.db.select().from(emailDeliveries).where(eq(emailDeliveries.templateKey, 'invitation'));
    expect(delivery).toMatchObject({ status: 'sent', recipientAddress: 'milton.test@example.test' });

    const visitor = await startSession(ctx.app);
    const accepted = await visitor.agent
      .post('/api/auth/set-password')
      .set('Origin', TEST_ORIGIN)
      .set(CSRF_HEADER, visitor.csrfToken)
      .send({ token, password: 'a long synthetic passphrase 2026' });
    expect(accepted.status).toBe(204);
  });

  it('falls back to a link to copy while delivery is off, although a test message is still sent', async () => {
    await configure(false);
    const admin = await signIn(ctx.app, emails.admin);
    const test = await send(admin, '/api/admin/email/test', { to: 'it.desk@example.test' }, null);
    expect(test.body.delivery.status).toBe('sent');
    expect(sink.messages).toHaveLength(1); // the test message went out

    const created = await send(admin, '/api/admin/users', {
      fullName: 'Milton Test',
      email: 'milton.test@example.test',
      role: 'sales',
      sectionIds: [ids.sectionGA],
    });
    expect(created.status).toBe(201);
    expect(created.body.link).toMatchObject({ purpose: 'invitation', delivery: 'manual' });
    await runJobs();
    expect(sink.messages).toHaveLength(1); // no invitation email
    expect(await ctx.database.db.select().from(emailDeliveries).where(eq(emailDeliveries.templateKey, 'invitation'))).toHaveLength(0);
  });
});
