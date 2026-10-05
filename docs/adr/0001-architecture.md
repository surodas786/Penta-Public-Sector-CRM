# ADR 0001 — Application architecture and data layer

**Status:** Accepted (Milestone 1)
**Date:** 04 October 2026

## Context

The repository began as a MagicPatterns export: a Vite + React + TypeScript +
Tailwind single-page application whose entire data layer was a browser
`localStorage` mock, with role filtering performed in the browser. The
requirements (`docs/Penta_CRM_Requirements.md`) demand that every access
decision be made on the server, over scoped database queries, with
transactions, audit and concurrency control.

`Plan.md` §4.1 proposes Express, PostgreSQL, Drizzle, Zod, Vitest and Supertest,
and states these are implementation choices to verify rather than settled facts.

## Decision

### One deployable application, two source trees

The approved React application stays where it is. An Express API is added
alongside it under `server/`, with a `shared/` directory of types, enums and
validation imported by both. One `package.json`, one lockfile, one container.

Microservices were rejected explicitly by the requirements for this release,
and nothing in the scope justifies a second deployable.

### PostgreSQL with Drizzle ORM

Chosen over a hand-written SQL layer because the schema and the queries stay in
one typed definition, and over Prisma because several things this schema needs
are awkward there:

- `NUMERIC(14,2)` money that must never become a float,
- partial unique indexes (one active lead per section now; one current tender
  per opportunity in a later milestone),
- `CHECK` constraints expressed next to the columns they guard,
- raw SQL where a query is genuinely better written as SQL (`DISTINCT ON` for
  the next-action lookup).

Migrations are committed SQL under `server/db/migrations/`, generated from
`server/db/schema.ts` by drizzle-kit, plus one hand-written migration for the
reference sequence, the circular section/lead foreign key, and the runtime
role's privileges.

### Access control as a SQL predicate

`server/policy/scope.ts` exports `opportunityScope(actor)`, which returns a SQL
fragment. Services compose it into every query — list, detail, count, child
reads. Scope is therefore applied *inside the database*, before filtering,
sorting, counting and pagination (SEC-002). There is no code path that loads
records and then filters them.

Routes never contain a permission rule. They validate input, read the actor
from the session, and call a service.

A lead's scope is `opportunity.section_id = actor.section_id` with no further
condition. A deactivated owner or a missing `manager_id` must not hide a
section record from its lead (`Plan.md` §3.1); fixtures and tests cover both.

### Money as decimal strings

BDT values are `NUMERIC(14,2)` in PostgreSQL and decimal strings everywhere
else — in the API, in validation, in React state. `shared/money.ts` does
arithmetic in integer paisa via `BigInt`. `pg` is pinned to return `NUMERIC` as
a string so a future driver default cannot silently introduce a float.
Conversion to `number` happens only in the Crore/Lakh display helper.

### Two database roles

`penta_migrator` owns the schema and runs migrations. `penta_app` is the
runtime account: no DDL, no superuser, and `INSERT`/`SELECT` only on
`audit_events` so audit rows cannot be altered through the application or
through a shell using the same credentials (SEC-012). An integration test
asserts the denial rather than trusting the grant.

### Separate production and demo builds

The approved prototype is preserved unchanged under `src/demo/`. `src/index.tsx`
branches on `import.meta.env.VITE_DEMO_MODE`, which Vite replaces with a
literal, so exactly one branch survives bundling. A production build contains
no demo component, no fixture and no browser-storage layer — verified by
scanning the built assets in `scripts/check-demo-exclusion.ts`, which is part
of `npm run build`.

## Consequences

- The 51 approved UI files keep their paths and styling. API-mode screens reuse
  the same primitives, so the two builds cannot drift visually by accident.
- Adding a feature means adding a table, a service and a route together; the
  policy module is the only file that decides access, so a reviewer has one
  place to check.
- `shared/` must stay free of Node-only and browser-only APIs. It is covered by
  both TypeScript projects, which enforces this at build time.
- Drizzle's generated migrations must be reviewed, not trusted blindly;
  anything it cannot express is written by hand in a numbered migration.

## Alternatives considered

| Option | Why not |
| --- | --- |
| Keep the browser mock, add an API later | The requirements treat browser-side filtering as a non-boundary. Retrofitting scope is how leaks happen. |
| Prisma | Weaker fit for partial unique indexes and raw constraints; several would have dropped to raw SQL anyway. |
| Raw SQL with `pg` only | No type safety between schema and queries, and far more hand-written SQL to keep correct. |
| Separate frontend and backend repositories | No independent deployment or scaling need; two repositories to keep in step for one product. |
| A snapshot endpoint returning the whole dataset | Forbidden by `Plan.md` §4.2, and it would push scope back into the browser. |
