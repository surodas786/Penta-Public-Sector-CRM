/**
 * Password hashing (SEC-030).
 *
 * argon2id via @node-rs/argon2, which ships prebuilt binaries for Windows,
 * macOS and Linux so no native toolchain is required. Parameters follow the
 * OWASP Password Storage Cheat Sheet's argon2id recommendation.
 *
 * Verification is deliberately constant-work for unknown accounts: see
 * `verifyAgainstDummy` below.
 */
import { Algorithm, hash, verify } from '@node-rs/argon2';

const HASH_OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19_456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(plaintext: string): Promise<string> {
  return hash(plaintext, HASH_OPTIONS);
}

export async function verifyPassword(storedHash: string, plaintext: string): Promise<boolean> {
  try {
    return await verify(storedHash, plaintext);
  } catch {
    // A malformed stored hash must read as "wrong password", never as an error
    // the caller could distinguish from a bad credential.
    return false;
  }
}

/**
 * A real argon2id hash of a value nobody can supply.
 *
 * Verified when the email is unknown so that a failed login costs the same
 * work whether or not the account exists — otherwise response timing
 * discloses account existence (SEC-030).
 */
let dummyHashPromise: Promise<string> | null = null;

function getDummyHash(): Promise<string> {
  dummyHashPromise ??= hashPassword(`absent-account-${Math.random()}-${Date.now()}`);
  return dummyHashPromise;
}

export async function verifyAgainstDummy(plaintext: string): Promise<false> {
  await verifyPassword(await getDummyHash(), plaintext);
  return false;
}
