/**
 * Environment-file round-trip guard.
 *
 * Node's `--env-file` / `loadEnvFile()` parser treats an unquoted `#` as the
 * start of an inline comment, so `PASSWORD=abc#def` silently becomes `abc`.
 * That bit this project once: the documented development password was
 * truncated before it ever reached the seed script, and every test still
 * passed because the seeding and asserting sides both read the same truncated
 * value.
 *
 * This check parses .env.example twice — once with Node's own parser, once by
 * reading the literal text after each `=` — and fails when they disagree. It
 * catches inline-comment truncation, stray quotes and trailing whitespace for
 * every variable, not just the one that caused the original problem.
 *
 *   npm run check:env
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

const FILE = path.resolve('.env.example');

interface Literal {
  key: string;
  value: string;
  line: number;
}

/** Reads what a human sees: the text after `=`, with surrounding quotes removed. */
function readLiterals(contents: string): Literal[] {
  const literals: Literal[] = [];

  contents.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) return;

    const separator = line.indexOf('=');
    if (separator === -1) return;

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();

    const quoted =
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2);
    if (quoted) value = value.slice(1, -1);

    literals.push({ key, value, line: index + 1 });
  });

  return literals;
}

const contents = readFileSync(FILE, 'utf8');
const literals = readLiterals(contents);

// Parse with Node's own parser, in an isolated copy of the environment so an
// already-set variable cannot mask a truncation.
const before = new Set(Object.keys(process.env));
for (const { key } of literals) delete process.env[key];
process.loadEnvFile(FILE);

const failures: string[] = [];

for (const { key, value, line } of literals) {
  const parsed = process.env[key];

  if (parsed === undefined) {
    failures.push(`${key} (line ${line}) was not parsed at all.`);
    continue;
  }

  if (parsed !== value) {
    const reason = value.includes('#') && !parsed.includes('#')
      ? "an unquoted '#' truncated it — wrap the value in double quotes"
      : 'the parsed value does not match the text in the file';
    failures.push(
      `${key} (line ${line}): file says ${JSON.stringify(value)}, ` +
        `Node parses ${JSON.stringify(parsed)} — ${reason}.`,
    );
  }
}

// Leave the environment as it was found.
for (const { key } of literals) {
  if (!before.has(key)) delete process.env[key];
}

if (failures.length > 0) {
  console.error('.env.example round-trip check FAILED:\n');
  for (const failure of failures) console.error(`  - ${failure}`);
  console.error(
    '\nA value that does not survive parsing is worse than a wrong one: the ' +
      'application silently uses something different from what the file shows.',
  );
  process.exit(1);
}

console.log(
  `.env.example round-trip check passed: ${literals.length} variables parse exactly as written.`,
);
