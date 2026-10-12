/**
 * What sending email needs at run time: this deployment's email configuration,
 * the transport it allows (none, capture or SMTP), and the application's own
 * address for links. Built once per process; tests pass their own transport.
 */
import type { EmailConfig, ServerConfig } from '../env.js';
import { createMailTransport, type MailTransport } from './transport.js';

export interface EmailRuntime {
  config: EmailConfig;
  /** Null when EMAIL_TRANSPORT=none: nothing is sent. */
  transport: MailTransport | null;
  appOrigin: string;
}

export function createEmailRuntime(config: Pick<ServerConfig, 'email' | 'appOrigin'>, transport?: MailTransport | null): EmailRuntime {
  return {
    config: config.email,
    transport: transport === undefined ? createMailTransport(config.email) : transport,
    appOrigin: config.appOrigin.replace(/\/$/, ''),
  };
}

/** For callers with no email configuration at all: sends nothing. */
export const NO_EMAIL: EmailRuntime = {
  config: { transport: 'none', secretKey: null, captureDir: '', sendTimeoutMs: 20_000 },
  transport: null,
  appOrigin: '',
};
