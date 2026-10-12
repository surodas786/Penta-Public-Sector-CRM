/**
 * Email administration endpoints (CR2), mounted at /api/admin/email inside
 * the administration router, so the same administrator-only guard applies.
 * The services check the role again and own every rule.
 */
import { Router, type Request, type RequestHandler } from 'express';
import { z } from 'zod';

import { EMAIL_TEMPLATE_KEYS, type EmailTemplateKey } from '../../shared/email.js';
import {
  emailTemplateContentSchema,
  paginationQuerySchema,
  sendTestEmailSchema,
  updateEmailSettingsSchema,
  updateEmailTemplateSchema,
  uuidField,
} from '../../shared/validation.js';
import type { Database } from '../db/client.js';
import type { EmailRuntime } from '../email/runtime.js';
import { notFound, unauthenticated } from '../http/errors.js';
import { signalJobsEnqueued } from '../jobs/queue.js';
import { parseOrThrow, singleValueQuery } from '../http/validate.js';
import {
  checkEmailConnection,
  getEmailSettings,
  listEmailDeliveries,
  listEmailTemplateHistory,
  listEmailTemplates,
  previewEmailTemplate,
  retryEmailDelivery,
  sendTestEmail,
  updateEmailSettings,
  updateEmailTemplate,
} from '../services/email.js';

function handle(fn: (...args: Parameters<RequestHandler>) => Promise<void>): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

const templateKey = z.enum(EMAIL_TEMPLATE_KEYS);

function readTemplateKey(value: unknown): EmailTemplateKey {
  const result = templateKey.safeParse(value);
  if (!result.success) throw notFound('unknown email template');
  return result.data;
}

function readId(value: unknown): string {
  const result = uuidField.safeParse(value);
  if (!result.success) throw notFound('malformed id parameter');
  return result.data;
}

export function createAdminEmailRouter(options: { db: Database; csrfGuard: RequestHandler; email: EmailRuntime }): Router {
  const { db, csrfGuard, email } = options;
  const router = Router();

  const actorOf = (req: Request) => {
    if (!req.actor) throw unauthenticated();
    return req.actor;
  };

  router.get(
    '/settings',
    handle(async (req, res) => {
      res.json(await getEmailSettings(db, actorOf(req), email));
    }),
  );

  router.put(
    '/settings',
    csrfGuard,
    handle(async (req, res) => {
      const command = parseOrThrow(updateEmailSettingsSchema, req.body);
      res.json(await updateEmailSettings({ db, actor: actorOf(req), runtime: email, command, requestId: req.requestId }));
    }),
  );

  router.post(
    '/test',
    csrfGuard,
    handle(async (req, res) => {
      const { to } = parseOrThrow(sendTestEmailSchema, req.body);
      res.json({ delivery: await sendTestEmail({ db, actor: actorOf(req), runtime: email, to, requestId: req.requestId }) });
    }),
  );

  // A POST because it reaches out to the mail server; it changes nothing.
  router.post(
    '/verify',
    csrfGuard,
    handle(async (req, res) => {
      res.json(await checkEmailConnection({ db, actor: actorOf(req), runtime: email }));
    }),
  );

  router.get(
    '/templates',
    handle(async (req, res) => {
      res.json({ items: await listEmailTemplates(db, actorOf(req)) });
    }),
  );

  router.put(
    '/templates/:key',
    csrfGuard,
    handle(async (req, res) => {
      const key = readTemplateKey(req.params.key);
      const command = parseOrThrow(updateEmailTemplateSchema, req.body);
      res.json(await updateEmailTemplate({ db, actor: actorOf(req), key, command, requestId: req.requestId }));
    }),
  );

  router.get(
    '/templates/:key/history',
    handle(async (req, res) => {
      res.json({ items: await listEmailTemplateHistory(db, actorOf(req), readTemplateKey(req.params.key)) });
    }),
  );

  // A POST only because it carries a body; it changes nothing.
  router.post(
    '/templates/:key/preview',
    csrfGuard,
    handle(async (req, res) => {
      const key = readTemplateKey(req.params.key);
      const content = parseOrThrow(emailTemplateContentSchema, req.body);
      res.json(previewEmailTemplate(actorOf(req), key, content, email.appOrigin));
    }),
  );

  router.get(
    '/deliveries',
    handle(async (req, res) => {
      const { page, pageSize } = parseOrThrow(paginationQuerySchema, singleValueQuery(req.query));
      res.json(await listEmailDeliveries(db, actorOf(req), page, pageSize));
    }),
  );

  router.post(
    '/deliveries/:id/retry',
    csrfGuard,
    handle(async (req, res) => {
      const delivery = await retryEmailDelivery({ db, actor: actorOf(req), deliveryId: readId(req.params.id), requestId: req.requestId });
      signalJobsEnqueued();
      res.json({ delivery });
    }),
  );

  return router;
}
