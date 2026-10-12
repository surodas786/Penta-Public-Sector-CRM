/**
 * Sending one message (CR2). Two real transports, chosen by EMAIL_TRANSPORT:
 *
 *   capture  writes the message as a JSON file and sends nothing. Used in
 *            development and tests, refused in production (env.ts).
 *   smtp     the administrator's mail server, through nodemailer.
 *
 * The message is plain text only. Every value in it comes from a template the
 * administrator wrote and from placeholder values the server computed, never
 * from a request, and the subject is checked for line breaks before it gets
 * here, so no header can be injected.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import nodemailer from 'nodemailer';

import type { EmailSecurityMode, EmailTransportKind } from '../../shared/email.js';

export interface OutgoingMessage {
  to: string;
  subject: string;
  text: string;
}

export interface MailServer {
  host: string;
  port: number;
  security: EmailSecurityMode;
  username: string | null;
  password: string | null;
  fromName: string | null;
  fromAddress: string;
  replyTo: string | null;
}

export interface MailTransport {
  readonly kind: EmailTransportKind;
  send(server: MailServer, message: OutgoingMessage): Promise<void>;
  /** Connects and signs in without sending anything; throws on failure. */
  verify(server: MailServer): Promise<void>;
}

/** A sending failure that is safe to log and show to an administrator. */
export class DeliveryError extends Error {}

/**
 * The failure without credentials or message content: the error class, the
 * SMTP reply code and the first line of the server's answer, shortened.
 */
export function describeDeliveryFailure(error: unknown): string {
  if (error instanceof DeliveryError) return error.message;
  const value = error as { code?: unknown; responseCode?: unknown; message?: unknown };
  const parts = [
    typeof value.code === 'string' ? value.code : null,
    typeof value.responseCode === 'number' ? `SMTP ${value.responseCode}` : null,
  ].filter(Boolean);
  const firstLine = typeof value.message === 'string' ? value.message.split('\n')[0]!.slice(0, 160) : 'Sending failed.';
  return [...parts, firstLine].join(' · ');
}

function fromHeader(server: MailServer): string | { name: string; address: string } {
  return server.fromName ? { name: server.fromName, address: server.fromAddress } : server.fromAddress;
}

export class CaptureTransport implements MailTransport {
  readonly kind = 'capture' as const;
  constructor(private readonly directory: string) {}

  async send(server: MailServer, message: OutgoingMessage): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const record = {
      capturedAt: new Date().toISOString(),
      from: fromHeader(server),
      replyTo: server.replyTo,
      to: message.to,
      subject: message.subject,
      text: message.text,
      note: 'Captured by EMAIL_TRANSPORT=capture. Not sent.',
    };
    await writeFile(path.join(this.directory, `${Date.now()}-${randomUUID()}.json`), JSON.stringify(record, null, 2), {
      flag: 'wx',
    });
  }

  /** There is no server to reach; the capture folder is created on first use. */
  async verify(_server: MailServer): Promise<void> {}
}

export class SmtpTransport implements MailTransport {
  readonly kind = 'smtp' as const;
  constructor(private readonly timeoutMs: number) {}

  private connect(server: MailServer) {
    return nodemailer.createTransport({
      host: server.host,
      port: server.port,
      secure: server.security === 'tls',
      requireTLS: server.security === 'starttls',
      ignoreTLS: server.security === 'none',
      auth: server.username ? { user: server.username, pass: server.password ?? '' } : undefined,
      connectionTimeout: this.timeoutMs,
      greetingTimeout: this.timeoutMs,
      socketTimeout: this.timeoutMs,
    });
  }

  async send(server: MailServer, message: OutgoingMessage): Promise<void> {
    const transporter = this.connect(server);
    try {
      await transporter.sendMail({
        from: fromHeader(server),
        to: message.to,
        replyTo: server.replyTo ?? undefined,
        subject: message.subject,
        text: message.text,
      });
    } finally {
      transporter.close();
    }
  }

  async verify(server: MailServer): Promise<void> {
    const transporter = this.connect(server);
    try {
      await transporter.verify();
    } finally {
      transporter.close();
    }
  }
}

export function createMailTransport(config: { transport: EmailTransportKind; captureDir: string; sendTimeoutMs: number }): MailTransport | null {
  switch (config.transport) {
    case 'capture':
      return new CaptureTransport(config.captureDir);
    case 'smtp':
      return new SmtpTransport(config.sendTimeoutMs);
    default:
      return null;
  }
}
