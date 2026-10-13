/**
 * Encrypts the SMTP password at rest (CR2, SEC-032).
 *
 * AES-256-GCM, the construction the backups use (scripts/ops/backup-common.ts),
 * with its own key: EMAIL_SECRET_KEY, which lives in the secret store and never
 * in the database. A copy of the database therefore does not reveal the mail
 * server password. The additional data binds a ciphertext to its purpose, so
 * it cannot be replayed as some other secret later.
 *
 * Stored as `v1:` + base64(iv | ciphertext | tag).
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const PREFIX = 'v1:';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const PURPOSE = Buffer.from('penta.email.smtp-password');

export function encryptSecret(key: Buffer, plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(PURPOSE);
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return PREFIX + Buffer.concat([iv, body, cipher.getAuthTag()]).toString('base64');
}

/** Null when the value cannot be read with this key (for example, after the key changed). */
export function decryptSecret(key: Buffer, stored: string): string | null {
  if (!stored.startsWith(PREFIX)) return null;
  const raw = Buffer.from(stored.slice(PREFIX.length), 'base64');
  if (raw.length < IV_BYTES + TAG_BYTES) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, IV_BYTES));
    decipher.setAAD(PURPOSE);
    decipher.setAuthTag(raw.subarray(raw.length - TAG_BYTES));
    return Buffer.concat([decipher.update(raw.subarray(IV_BYTES, raw.length - TAG_BYTES)), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
