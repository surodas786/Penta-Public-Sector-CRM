# Penta Public Sector Sales CRM — project instructions

A sales CRM for public sector project opportunities in Bangladesh, built from an
approved MagicPatterns prototype. Currently at the end of **Milestone 4**.

## Read before changing anything

| Document | Purpose |
| --- | --- |
| `docs/Penta_CRM_Requirements.md` | Functional source of truth. Requirement IDs (FR, BR, SEC, NFR, AT, D) are cited throughout the code. |
| `Plan.md` | Milestone plan and the rules this implementation follows. |
| `docs/progress.md` | What is actually built, tested and still missing. |
| `docs/adr/` | Architecture and authentication decisions, with the reasoning. |

Do not invent requirements, and do not silently relax a rule in either
document. If a conflict appears, follow the requirements and flag it.

## Non-negotiables

- **Access is decided on the server.** `server/policy/scope.ts` is the only
  place record scope and action permissions are defined. Routes call services;
  services compose the policy predicate into SQL. Never re-implement a
  permission rule in a route, and never filter for access in the browser.
- **A client-supplied owner, section, role or user id never grants anything.**
  Re-validate every proposed association against current database state.
- **Missing and inaccessible objects return an identical 404** (status, code,
  message, structure) so error shape cannot be used to probe for records.
  `NOT_FOUND_MESSAGE` in `server/http/errors.ts` is the single wording.
- **Money is a decimal string end to end**, `NUMERIC(14,2)` in PostgreSQL.
  Converting to `number` is allowed only at a display boundary.
- **Every multi-write operation is one transaction**, with its audit event
  written inside it. Version checks live in the UPDATE predicate.
- **Audit is append-only.** The runtime database role has INSERT and SELECT on
  `audit_events` and nothing else; migration `0001` enforces this.
- **The synthetic demo never reaches production.** It is a separate build
  (`npm run dev:demo`). `scripts/check-demo-exclusion.ts` fails the production
  build if demo code, fixtures or seed accounts appear in the bundle.
- **No real sales data, and no production deployment**, until explicitly
  instructed.

## Layout

```
shared/     types, enums and Zod schemas used by BOTH the browser and server
server/     Express API: db/ policy/ services/ routes/ auth/ http/ tests/
src/        React app
  app/      API mode (production path)
  demo/     the approved synthetic prototype, unchanged
  components/, pages/, utils/   approved UI, reused by both
e2e/        Playwright smoke + milestone browser checks, screenshot evidence
docs/       requirements, progress, ADRs, evidence
```

## Commands

Every command below exists and has been run. See `README.md` for setup.

```bash
npm run db:up          # start PostgreSQL (docker compose)
npm run db:migrate     # apply migrations (schema-owner role)
npm run db:seed        # synthetic fixtures; refuses production
npm run dev:server     # API on :4800
npm run dev            # web on :5173
npm run dev:demo       # the approved synthetic prototype, no API, no database

npm run typecheck      # web + server + e2e projects
npm run lint
npm test               # backend integration suite (the milestone gate)
npm run test:smoke     # Playwright browser checks (three isolated runs)
npm run build          # web (with demo-exclusion checks) + server
```

## Conventions

- Comments explain *why*, and cite the requirement ID where a rule is
  non-obvious. Do not add comments that restate the code.
- A leading underscore marks a deliberately unused binding; ESLint is
  configured to honour it.
- Server and shared modules use explicit `.js` import extensions (NodeNext).
- Tests assert behaviour through the real app and a real database. Do not stub
  policy, sessions or the database.
- Add a table with the feature that uses it, not in advance.

## Current state

Milestones 1–4 are complete: persistence, authentication, server-side
permissions, opportunity create / list / detail / basic edit, stage and status
transitions (board and dropdown), Awarded/Lost outcomes, management-only
reopening, the follow-up lifecycle, ownership transfers, management's team
view, account and section administration, single-use invitation/reset
links, the organization directory, contacts with link-scoped relationship
notes, and activities — all with optimistic concurrency, durable idempotency and audit.

Every writer locks the opportunity row before any follow-up row; account
changes lock the active administrator rows first, in id order. Keep both
orders in new services (ADRs 0003 and 0004).

Never log request data: unexpected errors go through `describeForLog` in
`server/http/errors.ts` (SEC-032).

Contacts are visible only through links to accessible opportunities
(`contactScope`); relationship notes live on the link, never the contact.

Tenders, documents, dashboards, reports, search and notifications are **not**
implemented. They are visibly unavailable in the UI
rather than mocked. See `docs/progress.md` before starting Milestone 5.
