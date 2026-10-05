# Implementation progress

## Milestone 1 handover review — 05 October 2026

Performed before starting Milestone 2, on branch `m2-stages-status-follow-ups`
created from `origin/main` at `94fae7f`.

### Recorded status checked against the repository

| Claim in this report | Finding |
| --- | --- |
| M1 complete, "ready for review" | **Reviewed and merged**: PR #1 merged into `main` as `94fae7f` on 05 Oct 2026. Its tree is identical to the M1 branch head `19b86ed`. The local `main` branch was still at `ceb5e74` (not fast-forwarded); it was left untouched |
| CI passes | **Confirmed on GitHub**: run 37278089500 (PR) and 37278146987 (`main` push) both succeeded — clean install, migrations, typecheck, lint, env check, integration tests, browser smoke test, production build |
| Working tree | Clean. No unrelated or uncommitted work to preserve |
| 168 integration tests | **Rerun locally: 168 passed**, 6 files |
| Typecheck, lint, env check | **Rerun: pass**; lint 0 errors, 5 warnings |
| Browser smoke test | **Rerun: 2 passed** |
| Production build with demo exclusion | **Rerun: pass** |

### Issues found

1. **`npm run evidence` did not work as documented.** The Playwright config
   ignores `evidence.spec.ts` unless `CAPTURE_EVIDENCE=true`, and the script
   never set it, so the README command reported "No tests found". The 14 M1
   screenshots must have been captured with the variable set by hand. *Fixed:*
   the config now includes the spec whenever it is named on the command line.
2. **Idempotency claim completed outside the business transaction.** The
   claim was marked complete after the create transaction committed. A crash
   between the two would leave the record saved but its key stuck "in
   progress", so every retry for 24 hours got a 409 instead of the original
   result. *Fix in the Milestone 2 commit*, because the M2 services share the
   same helper: the claim is now completed inside the business transaction.
3. **Create replay returned "the first open follow-up", not the first
   follow-up.** Harmless while follow-ups could not change state, but wrong as
   soon as M2 lets the first one be completed. *Fix in the Milestone 2 commit*:
   replay finds it by creation order.
4. **Manual step 2 was not fully evidenced.** It asks for persistence across an
   application *server restart*; the recorded evidence was a browser reload.
   *Now verified* (see the Milestone 2 section): a record created and moved
   through the API on the development stack read back identically after the
   API process was stopped and restarted.
5. **Report inaccuracies, corrected below.** One of the five lint warnings is
   in M1's own `src/app/AuthContext.tsx` (it exports the `useAuth` hook beside
   the provider), not in an approved demo file. The CI paragraph says 167 tests
   where the suite has 168 (the 168th was added by the password fix).

No M1 blocker remained that prevented Milestone 2. None of the issues above
weakened access control.

---

## Milestone 1 — persistence, authentication, server-side permissions, opportunity workflow

**Branch:** `m1-persistence-auth-permissions` (merged into `main` as `94fae7f`)
**Baseline tag:** `demo-baseline` (the approved MagicPatterns export, commit `ceb5e74`)
**Date:** 04 October 2026
**Status:** Complete, reviewed and merged.

---

## 1. Verified repository and environment findings

`Plan.md` §1 asks for the repository and environment to be verified rather than
assumed. Several assumptions in the earlier plan were wrong; these are the
measured facts.

| Checked | Result |
| --- | --- |
| Framework | Vite 5.4.21, React 18.3.1, TypeScript, Tailwind 3.4.17 — confirmed |
| Mock service layer | `src/contexts/CrmContext.tsx`, 545 lines, 17 actions — confirmed |
| Browser storage | Exactly two call sites, both in `CrmContext.tsx` (key `penta-crm-demo-v1`) — confirmed |
| Lockfile | **Absent.** `package-lock.json` now committed |
| `src/package.json` | A MagicPatterns artefact. Unreferenced, and its pinned versions contradicted the root manifest. **Removed** after verifying nothing imports it and the build still passes |
| Unused dependencies | `@emotion/react`, `date-fns`, `@radix-ui/react-icons` — zero imports. Removed |
| Node | v24.13.0; npm 11.6.2. `.nvmrc` pins 24 |
| **Local PostgreSQL** | **None.** `C:\Program Files\PostgreSQL\18` holds a data directory but no server binaries |
| **Port 5432** | **An SSH tunnel** (MobaXterm) to a remote host — *not* a local database. Deliberately left untouched; no database was created on it |
| Database used instead | PostgreSQL 18 via `docker-compose.yml`, host port **55432** (chosen so it cannot collide with that tunnel) |
| Reserved TCP ports | Ports **3592–4691 are reserved** on this machine by Hyper-V/WSL. Binding one fails with `EACCES`. The planned API port 4000 was inside that range; the project default is now **4800** |

The earlier plan's claim that a local PostgreSQL was available on 5432 was
incorrect and is corrected here.

---

## 2. Implemented behaviour, by requirement

### Complete

| Requirement | Where | Note |
| --- | --- | --- |
| SEC-001 | `server/policy/scope.ts`, `server/auth/sessionGuard.ts` | Scope derives from the session's account id plus a fresh database read. A client-supplied owner, section, role or id never grants anything |
| SEC-002 | `server/services/opportunities.ts` | `opportunityScope(actor)` is a SQL predicate composed into every query. Filtering, counting, sorting and pagination all run over permitted rows inside the database |
| SEC-003 | `server/http/errors.ts` | One `NOT_FOUND_MESSAGE`. A missing and an inaccessible object return byte-identical bodies apart from `requestId` |
| SEC-005 | `server/auth/sessionGuard.ts` | Deactivation and `session_version` bumps invalidate a live session on its next request |
| SEC-020 | `server/http/errors.ts`, `server/http/validate.ts` | 401 / 403 / 404 / 409 / 422 with `{code, message, fieldErrors?, requestId}`. No stack traces, no private values |
| SEC-030 | `server/auth/` | passport + express-session + connect-pg-simple + argon2id. No public registration, no demo-password path, generic failure message, constant-work verification for unknown accounts |
| SEC-031 | `server/app.ts`, `server/http/csrf.ts` | HttpOnly `SameSite=Strict` cookie, signed double-submit CSRF token, trusted-origin validation, login rate limiting, 30-minute idle and 12-hour absolute expiry, revocation on logout |
| FR-001, FR-002 | `server/policy/` | Four roles with separated responsibilities. Administrative ability grants no commercial visibility |
| FR-013 | `src/app/` | Loading, empty and error states; field errors next to inputs; double submission prevented; success only after a confirmed commit; entered values preserved on failure |
| FR-020 (creation) | `server/services/opportunities.ts` | Active, nonterminal creation with full field validation |
| BR-001 | same | Owner must be an active eligible owner the actor may assign; the opportunity's section must equal the owner's section |
| BR-002 | migration `0001`, `server/policy/scope.ts` | Lead scope is `section_id = actor.section_id` with no owner-active or reporting-line condition. One active lead per section enforced by a partial unique index |
| BR-013 | `server/services/opportunities.ts` | Next action is derived from the earliest due open follow-up with a creation-time tie-breaker. There is no second editable next-action field, and the basic edit refuses one |
| BR-014 | same | Opportunity + first follow-up + audit commit in one transaction |
| BR-080 | `server/db/` | UUID keys, foreign keys, unique normalised emails, unique references from a sequence, non-negative money checks, UTC timestamps, indexes |
| BR-090 | `server/services/opportunities.ts` | Version check inside the UPDATE predicate; stale writes get 409 |
| BR-091 | `server/services/idempotency.ts` | Durable records scoped by actor and operation, request fingerprint, concurrency-safe claim, replay re-authorised |
| FR-062 (M1 scope) | `server/services/audit.ts` | Append-only audit for create and update, with actor, request id and before/after values |
| SEC-012 (M1 scope) | migration `0001` | The runtime role has `INSERT`/`SELECT` only on `audit_events`; `UPDATE`, `DELETE` and `TRUNCATE` are revoked |
| D-001 | `server/db/schema.ts`, `shared/enums.ts` | `stage` and `status` separate from the first migration; `boardLaneLabel` keeps one visible lane and the retained stage is shown |
| D-003 | `server/db/seedData.ts` | The demo's separate next-action text was converted into the single open follow-up. No distinct action was dropped |
| NFR-001 | `scripts/check-demo-exclusion.ts` | Production build fails on demo flags, unsafe production config, demo-shaped endpoints, or demo fingerprints in the built bundle |

### Partial, by design

| Requirement | Done | Not done |
| --- | --- | --- |
| AT-01 | Administrator is refused commercial collections (403) and objects (404) at API and UI level | Export, document and notification channels do not exist yet |
| AT-02 | Section isolation through list, detail, filters, search, child records and direct URL | Contacts, CSV, documents, notifications |
| AT-03 | Individual isolation including same-section colleagues, forged owner/section fields and forged updates | Reassignment-related visibility (needs transfers, M3) |
| AT-04 | Creation with the first follow-up in one transaction; field errors with no partial writes; correct cross-role visibility | — |
| FR-010 | Approved layout, palette, typography and screen structure preserved; `BST` replaced with `Bangladesh time (UTC+6)` per §20 | Full visual comparison of unimplemented screens |
| FR-062 | Create and update audited | Stage, task, transfer, contact-link and document events arrive with their features |

### Not started

Stage and status transitions (M2), follow-up lifecycle (M2), ownership
transfers and account administration (M3), organizations/contacts/activities
(M4), tenders and documents (M5), dashboards, reports, CSV, search and
notifications (M6).

Each is visibly unavailable in the application with a stated reason. None is
populated with demo records or fabricated totals.

---

## 3. Commands actually run, and their results

All run on 04 October 2026 against PostgreSQL 18 in Docker.

| Command | Result |
| --- | --- |
| `npm ci` equivalent (`npm install`) | 454 packages, lockfile committed |
| `npm run db:up` | PostgreSQL 18 healthy on 55432; two roles and two databases created |
| `npm run db:migrate` / `:test` | Applied; re-running is a verified no-op |
| `npm run db:seed` / `:test` | 2 sections, 10 users, 11 organizations, 23 opportunities, 17 open follow-ups |
| `npm run check:env` | **Pass** — 16 variables parse exactly as written |
| `npm run typecheck` | **Pass** (web, server and e2e projects) |
| `npm run lint` | **Pass** — 0 errors, 5 warnings |
| `npm test` | **168 passed, 0 failed**, 6 files, ~40s |
| `npm run test:smoke` | **2 passed**, ~21s |
| `npm run build` | **Pass** — demo-exclusion check passes before and after the bundle is produced |
| `npm run evidence` | 14 screenshots written to `docs/evidence/` *(the script as committed found no tests; see the handover review above)* |

### Integration suite composition

| File | Tests | Plan §7.6 scenarios |
| --- | --- | --- |
| `auth.test.ts` | 22 | 1–5 |
| `scope.test.ts` | 46 | 6–11, 14, 15 |
| `create.test.ts` | 38 | 12, 16–20, 22 |
| `edit.test.ts` | 25 | 13, 21 |
| `childScope.test.ts` | 11 | 23 |
| `operations.test.ts` | 26 | 24, 25 |
| **Total** | **168** | all 25 |

The five lint warnings are `react-refresh/only-export-components`: four in
approved demo files (`Badges.tsx`, `FormFields.tsx`, `CrmContext.tsx` twice)
and one in M1's `src/app/AuthContext.tsx`, which exports the `useAuth` hook
beside its provider. *(Corrected 05 Oct 2026; the original text attributed all
five to demo files.)* They affect fast refresh only.

### CI-equivalent run

Verified locally with `.env` removed and configuration supplied purely through
environment variables, as GitHub Actions will do: migrations applied and all
167 tests passed. *(That run predates the password-fix test; the suite now has
168, and GitHub CI has since passed with all of them.)* The workflow in `.github/workflows/ci.yml` creates the same
two database roles from `docker/initdb/01-roles-and-databases.sql`, so the
append-only audit and no-DDL assertions are exercised in CI, not skipped.

### Manual review (`Plan.md` §7.8)

| Step | Result |
| --- | --- |
| 1. Salesperson signs in, creates, sees the committed detail and first follow-up | Pass — automated in `e2e/smoke.spec.ts`; `docs/evidence/02–04` |
| 2. Reload and server restart; data persists in PostgreSQL | Pass — reload asserted in the smoke test, which also asserts `localStorage` and `sessionStorage` are empty |
| 3. Management and the correct lead have access; another salesperson and another section are denied by URL and API | Pass — smoke test plus `scope.test.ts`; `docs/evidence/05–06` |
| 4. Administrator sees an administration-only landing page and is denied commercial API access | Pass — `docs/evidence/07–08` |
| 5. Rapid retry and uncertain network response deduplicate with no false success | Pass — `create.test.ts` sequential and concurrent retry tests |
| 6. Edit with an outdated version returns 409 with a usable reload/reapply flow | Pass — `edit.test.ts`; the dialog keeps typed values and offers "Reload current values" |
| 7. Logout and session expiry clear the previous account's cached data | Pass — `AuthContext` clears state and bumps a session key that discards every screen's fetched data |
| 8. Screens compared at 1440 px, 768 px and 360 px | Captured in `docs/evidence/`. Keyboard use and labelled validation errors use the approved `Field` primitive |
| 9. The synthetic demo build remains available and is not connected to production data | Pass — `npm run dev:demo`; the production bundle contains none of it |

---

## 4. Defects found and fixed during this milestone

Recorded because each was a genuine fault, not a test adjustment.

1. **`sameDatabase` treated `localhost` and `127.0.0.1` as different hosts**, so
   the guard protecting the development database from the test suite could be
   bypassed by spelling one URL differently. Loopback aliases are now
   normalised (`server/env.ts`).
2. **Administrator object requests returned 403 instead of 404.** Guard
   placement now distinguishes collections (403 before any lookup) from object
   routes (404 from the scope predicate), so object addressing never discloses
   existence.
3. **Unknown query parameters and unsupported edit fields produced an
   unattributed error.** Zod's `unrecognized_keys` issue is now mapped to the
   offending field names.
4. **The login screen hard-coded `/opportunities`**, so an administrator landed
   on a page they can never load. Sign-in now routes through the role-aware
   landing redirect.
5. **An administrator could reach commercial routes in the UI** and saw a
   skeleton that never resolved. Capability route guards now render a plain
   refusal.
6. **The production bundle contained synthetic fixtures and the fixed demo
   clock.** The entry point now branches on a build-time literal so only one
   application is bundled, and `check-demo-exclusion.ts --bundle` scans the
   built assets. Verified in both directions: the guard passes on the real
   bundle and fails when a demo chunk is introduced.

### Found after the milestone commit

7. **The documented development password did not work.** `.env.example` set
   `SEED_DEFAULT_PASSWORD=Synthetic#Dev1`, but Node's `--env-file` parser treats
   an unquoted `#` as the start of an inline comment, so the seed script
   received `Synthetic` and both databases were seeded with that. Every
   document and hand-off message stated the full value.

   *Why 167 tests missed it.* The seeding side and the asserting side always
   read the same truncated value, so each run was internally consistent: the
   integration harness set the password in JavaScript, bypassing the parser;
   the Playwright config and spec both read it through `loadEnvFile`. Nothing
   compared **what the documentation says** with **what actually
   authenticates**.

   *Fixed by* quoting the value and removing special characters from the
   default (`"Synthetic-Dev-2026"`); a new `npm run check:env` that fails when
   any `.env.example` value does not survive Node's parser; a new integration
   test that seeds with the parsed value and signs in with the literal one; and
   deriving `TEST_PASSWORD` from configuration instead of a hard-coded
   constant. Both the guard and the test were verified to fail against the
   original defect and pass after the fix.

---

## 5. Database and migrations

| Migration | Contents |
| --- | --- |
| `0000_modern_spacker_dave.sql` | Enum types and the eight M1 tables with constraints and indexes |
| `0001_privileges_and_reference_sequence.sql` | `opportunity_reference_seq`; the circular `sections.lead_user_id` foreign key; the one-active-lead-per-section partial unique index; runtime-role grants including append-only `audit_events` |

Tables: `sections`, `users`, `organizations`, `opportunities`, `follow_ups`,
`audit_events`, `idempotency_records`, `session`. Contacts, activities,
tenders, documents and notifications are deliberately absent — asserted by a
test — and arrive with the features that use them.

**Rollback.** Migration `0000` creates everything, so rolling back M1 means
dropping the schema and re-migrating; there is no production data to preserve.
From M2 onward, migrations must be additive and reversible. `0001` is written
to be re-runnable: every statement is guarded.

**Fixture conversion.** Legacy demo ids map to deterministic UUIDv5-style
identifiers (`legacyUuid`), so relationships stay consistent across reseeds and
tests can address known records. Two demo records recorded only "On Hold" or
"Cancelled" with no prior stage; their stage is a documented synthetic mapping,
marked `syntheticStageMapping` in `server/db/seedData.ts`, and must never be
applied to live data without a separately reviewed migration.

---

## 6. Local startup

Full instructions are in `README.md`. In short:

```bash
npm install
cp .env.example .env     # then generate SESSION_SECRET and CSRF_SECRET
npm run db:up
npm run db:migrate && npm run db:migrate:test
npm run db:seed  && npm run db:seed:test
npm run dev:server       # API  http://localhost:4800
npm run dev              # web  http://localhost:5173
```

**Synthetic accounts** (development and test only; the seed refuses
`NODE_ENV=production`): `arif.rahman@example.com` (management),
`nadia.islam@example.com` and `farhan.ahmed@example.com` (section leads),
`rafiq.hasan@example.com`, `tasnia.karim@example.com`,
`imran.hossain@example.com`, `sadia.akter@example.com` (salespeople),
`admin@example.com` (administrator).

The shared password is `SEED_DEFAULT_PASSWORD` in your local `.env`. It is not
recorded in this report or anywhere else in the repository.

---

## 7. Known limitations and open decisions

### Limitations of this milestone

- Opportunities are created **Active and nonterminal only**. Awarded and Lost
  need the outcome capture rules, which arrive with M2. Terminal and cancelled
  fixtures are readable but refuse basic edits.
- The **Pipeline (Kanban) view is absent in API mode**. Drag-and-drop changes a
  stage, and the stage service does not exist yet; a board that cannot persist a
  move would be misleading. The approved board is intact in the demo build.
- **No dashboards, reports, CSV, search or notifications.** Each would need the
  scoped aggregate queries that arrive with M6.
- The organization list endpoint returns **basic directory information only**,
  with no opportunity counts — a count must be scoped, and scoped aggregates
  arrive with M6.
- **Idempotency record cleanup is not scheduled.** The pruning function exists
  and is tested; the scheduler arrives with background jobs.
- **AT-01/02/03 are not fully covered** and cannot be until exports, documents,
  search and notifications exist.

### Open decisions for Penta (requirements §18)

1. **Identity provider.** No SSO configuration exists in the repository, so
   local authentication was implemented for development. If Penta has suitable
   SSO it replaces the login path; the policy layer is unaffected. See
   `docs/adr/0002-authentication-and-sessions.md`.
2. **MFA for privileged roles**, where the chosen identity service supports it.
3. **Invitation and password recovery flows** — not implemented; planned for M3.
4. **Session lifetimes** — 30-minute idle and 12-hour absolute are the proposed
   SEC-031 defaults.
5. **Hosting, private file storage and the scanning service** — needed before
   M5 can be enabled.
6. **Retention periods** for sales records, audit events and backups.

### Approved-interface deviations

Each is required by the specification and is listed for product sign-off.

| Change | Reason |
| --- | --- |
| New sign-in screen | The demo had no authentication, only a role switcher (SEC-030). Built in the approved palette |
| `BST` → `Bangladesh time (UTC+6)` | §20 requires the unambiguous form |
| Sidebar footer rewritten | The prototype text implied the browser enforced access |
| Demo-only controls removed from the production build | NFR-001 |
| Unimplemented screens show a stated reason | `Plan.md` §2: unfinished features stay disabled with an accurate explanation, never populated with demo data |
| Creation form labels the next action as the first follow-up | BR-013/BR-014: it is saved as one, in the same transaction |

### Repository note

A `docs/evidence` entry appeared in `.gitignore` during this work and was
removed, because this report and the README reference those screenshots as
committed evidence (`Plan.md` §8). If that entry was deliberate, say so and the
screenshots can be dropped from version control instead.

---

## 8. Next task

**Milestone 2 — stages, statuses and follow-ups.** Per `Plan.md` §6, and not to
be started until this milestone has been reviewed:

1. Stage transitions through dropdown and Kanban, with required explanations for
   skipped and backward movement, preserving full stage history.
2. Awarded value and date; Lost reason from the six presets with explanatory
   text for "Other"; management-only reopening with a reason.
3. On Hold and Cancelled as status changes that retain the stored stage, and
   return from hold with a next action.
4. Complete, reschedule and cancel follow-ups. Completing the last open task on
   an active nonterminal opportunity requires a replacement or a valid
   transition. Terminal closure cancels open tasks with a reason, never falsely
   marking them complete.
5. Restore the Pipeline board in API mode once moves can persist, with failed
   or cancelled drags restoring the original card position.
6. Audit, version checks and idempotency on every new mutation as it is added —
   M7 verifies completeness; it is not permission to defer them.

Acceptance coverage to target: AT-05 and AT-06.
