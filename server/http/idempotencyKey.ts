/**
 * Reads the client-generated idempotency key (BR-091).
 *
 * Every mutation that can be retried after an uncertain network result
 * requires one, so the retry is recognised instead of being applied twice.
 */
import type { Request } from 'express';

import { IDEMPOTENCY_HEADER } from '../../shared/api.js';
import { validationFailed } from './errors.js';

export function requireIdempotencyKey(req: Request): string {
  const key = req.get(IDEMPOTENCY_HEADER)?.trim();
  if (!key || key.length < 8 || key.length > 200) {
    throw validationFailed({
      [IDEMPOTENCY_HEADER]:
        'Provide an Idempotency-Key header between 8 and 200 characters so a retry cannot be applied twice.',
    });
  }
  return key;
}
