/**
 * Shared pieces of the backup and restore tooling (NFR-002).
 *
 * Format of one backup directory:
 *
 *   backup-info.json      plaintext: format, time, file counts. Nothing commercial.
 *   manifest.json.enc     encrypted: per-table row counts at the snapshot, and
 *                         every document file's storage key and SHA-256
 *   database.dump.enc     encrypted pg_dump (custom format) of that snapshot
 *   files/<key>.enc       encrypted document files, one per stored revision
 *
 * Encryption: AES-256-GCM per file, with a random 12-byte IV prefixed and the
 * 16-byte tag appended. The key (BACKUP_ENCRYPTION_KEY, 64 hex characters)
 * never sits beside the backup; losing it loses the backup.
 *
 * PostgreSQL client tools: `pg_dump` / `pg_restore` must match the server's
 * major version. Locally the docker container provides them:
 *   PG_TOOLS_CONTAINER=penta-crm-postgres   runs them with `docker exec`
 */
import { spawn } from 'node:child_process';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Transform, type Readable, type Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export const BACKUP_FORMAT = 'penta-crm-backup/1';

export function encryptionKey(): Buffer {
  const hex = process.env.BACKUP_ENCRYPTION_KEY?.trim() ?? '';
  if (!/^[0-9a-f]{64}$/i.test(hex)) {
    throw new Error(
      'BACKUP_ENCRYPTION_KEY must be 64 hex characters (32 bytes). Generate one with ' +
        '`node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"` and keep it apart from the backups.',
    );
  }
  return Buffer.from(hex, 'hex');
}

/** Streams `source` through AES-256-GCM into `target`: IV ‖ ciphertext ‖ tag. */
export async function encryptStream(source: Readable, target: string, key: Buffer): Promise<{ sha256: string; bytes: number }> {
  await mkdir(path.dirname(target), { recursive: true });
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const plainHash = createHash('sha256');
  let bytes = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      plainHash.update(chunk);
      bytes += chunk.length;
      callback(null, chunk);
    },
  });
  const out = createWriteStream(target, { mode: 0o600 });
  out.write(iv);
  await pipeline(source, meter, cipher, out as Writable, { end: false });
  await new Promise<void>((resolve, reject) => out.end(cipher.getAuthTag(), (error?: Error | null) => (error ? reject(error) : resolve())));
  return { sha256: plainHash.digest('hex'), bytes };
}

export function encryptFile(source: string, target: string, key: Buffer) {
  return encryptStream(createReadStream(source), target, key);
}

/** Decrypts a whole file into memory, verifying the GCM tag (any tampering fails). */
export async function decryptToBuffer(source: string, key: Buffer): Promise<Buffer> {
  const data = await readFile(source);
  const iv = data.subarray(0, 12);
  const tag = data.subarray(data.length - 16);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data.subarray(12, data.length - 16)), decipher.final()]);
}

export async function writeEncryptedJson(target: string, value: unknown, key: Buffer): Promise<void> {
  const { Readable } = await import('node:stream');
  await encryptStream(Readable.from([Buffer.from(JSON.stringify(value, null, 2))]), target, key);
}

export async function readEncryptedJson<T>(source: string, key: Buffer): Promise<T> {
  return JSON.parse((await decryptToBuffer(source, key)).toString('utf8')) as T;
}

export const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');

/**
 * Runs a PostgreSQL client tool, natively or inside the local container.
 * Inside the container the server is reached on its own loopback port.
 */
export function pgTool(tool: 'pg_dump' | 'pg_restore', args: string[], connectionUrl: string, stdin?: Buffer): {
  stdout: Readable;
  done: Promise<void>;
} {
  const container = process.env.PG_TOOLS_CONTAINER?.trim();
  const url = new URL(connectionUrl);
  if (container) {
    url.hostname = '127.0.0.1';
    url.port = '5432';
  }
  const fullArgs = [...args, `--dbname=${url.toString()}`];
  const child = container
    ? spawn('docker', ['exec', '-i', container, tool, ...fullArgs], { stdio: ['pipe', 'pipe', 'pipe'] })
    : spawn(tool, fullArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
  if (stdin) child.stdin.end(stdin);
  else child.stdin.end();
  const done = new Promise<void>((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${tool} exited with ${code}: ${stderr.replace(/postgres(ql)?:\/\/[^\s]+/g, '<url>').slice(0, 500)}`)),
    );
  });
  return { stdout: child.stdout, done };
}

/** The storage layout of LocalDocumentStorage: objects/<first two>/<key>. */
export function objectPath(storageRoot: string, key: string): string {
  return path.join(path.resolve(storageRoot), 'objects', key.slice(0, 2), key);
}

export async function writeJson(target: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`);
}

export interface BackupManifest {
  format: string;
  createdAt: string;
  snapshot: string;
  migrations: number;
  tableCounts: Record<string, number>;
  files: { key: string; sha256: string; bytes: number; scanState: string }[];
  /** Revisions whose file is quarantined (infected) and deliberately not copied. */
  quarantined: string[];
  dump: { sha256: string; bytes: number };
}
