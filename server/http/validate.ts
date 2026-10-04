/**
 * Turns a Zod result into the SEC-020 422 payload.
 *
 * The same schemas run in the browser, so a field error the user sees locally
 * is the one the server would have produced.
 */
import type { ZodType } from 'zod';

import { validationFailed } from './errors.js';

export function parseOrThrow<TSchema extends ZodType>(
  schema: TSchema,
  value: unknown,
  message?: string,
): TSchema['_output'] {
  const result = schema.safeParse(value);
  if (result.success) return result.data;

  const fieldErrors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    // An unrecognised key carries an empty path, so attribute the error to each
    // offending key by name instead of to a generic bucket. This is what makes
    // an unsupported filter or a non-allowlisted edit field nameable in the
    // response (plan 7.4).
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) {
        fieldErrors[key] ??= 'This field is not supported here.';
      }
      continue;
    }
    const key = issue.path.length > 0 ? issue.path.join('.') : '_';
    // Keep the first error per field: forms show one message per input.
    fieldErrors[key] ??= issue.message;
  }

  throw validationFailed(fieldErrors, message);
}

/**
 * Express 5 exposes `req.query` as a getter returning a parsed object. Query
 * values arrive as strings (or arrays); the schemas expect single strings, so
 * repeated parameters are rejected rather than silently taking the last one.
 */
export function singleValueQuery(query: unknown): Record<string, string> {
  const source = (query ?? {}) as Record<string, unknown>;
  const flat: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'string') {
      flat[key] = value;
    } else if (Array.isArray(value)) {
      throw validationFailed({ [key]: 'Provide this filter only once.' });
    } else if (value !== undefined) {
      throw validationFailed({ [key]: 'Unsupported filter value.' });
    }
  }
  return flat;
}
