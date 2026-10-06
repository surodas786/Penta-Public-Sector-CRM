# ADR 0008 — Audit and mutation-control sweep

**Status:** Accepted for development (Milestone 7).
**Date:** 06 October 2026
**Requirements:** FR-062, SEC-012, SEC-003, SEC-005, BR-090, BR-091, AT-15

Milestone 7 added no feature. It verified every implemented mutation against
the audit, concurrency and retry rules, and fixed the gaps it found. The
decisions below are the ones a later change must keep.

## Lock order: the opportunity first, for every write to its data

ADR 0003 required every writer to lock the opportunity row before a
follow-up row. Two writers did not lock the opportunity at all:

- **Activity amendment** locked only the activity row. A transfer could
  commit between the amendment's scope check and its update, so the previous
  owner's edit landed after they had lost access.
- **The basic opportunity edit** read the record outside its transaction and
  relied on the version in the UPDATE predicate. Concurrency was safe, but a
  previous owner whose edit queued behind a transfer received **409
  version_conflict** — telling them the record still exists and has changed —
  instead of the standard 404 (SEC-003). Its audit before-values also came
  from that earlier read.

Both now lock the opportunity row through scope inside the transaction
(`lockOpportunity`, `SELECT … FOR UPDATE`). PostgreSQL re-evaluates the scope
predicate on the committed row, so a write that queued behind a transfer
finds nothing and answers 404. Every writer of an opportunity's data —
opportunity, follow-ups, activities, contact links, tenders, documents — now
takes this lock first; the tests in `m7MutationControls.test.ts` hold a
separate connection on the row and queue each of them behind a transfer.

## Account changes begin with the administrator locks

ADR 0004 locked the active administrator rows first, but only in account
updates and deactivation. Account creation, reactivation, sign-in links and
every section change skipped it, so an administrator demoted or deactivated
while one of those requests waited could still complete it, and two such
changes could take user and section locks in different orders. Every account
and section change now starts with `beginAdministrativeChange`: lock the
active administrator rows in id order, then confirm the actor is still one
of them (403 otherwise). All administrative transactions are therefore
serialised on the same first lock.

## Reporting-line changes are account changes

Installing a section lead re-points every salesperson in the section. That
changed each person's `manager_id` with no audit event of its own (FR-062:
account changes). Each re-pointed person now gets `account.manager_changed`
(before/after manager, the administrator and the reason), in the same
transaction.

## Append order for audit events (migration 0007)

Events written in one transaction can share `occurred_at`, and always do under
the frozen test clock. History paged by time alone had no defined order at a
page boundary. `audit_events.sequence` is a `GENERATED ALWAYS` identity;
commercial and administrative history order by `(occurred_at DESC, sequence
DESC)`. The runtime role cannot set or rewrite it (identity column, and no
UPDATE privilege).

## Replays re-check read access, not the original action

A replayed idempotent request returns the stored outcome by re-reading the
entity through the caller's **current** scope; nothing commercial is stored
with the key. Once the record has left the caller's scope the replay is the
standard 404. A replay does not re-run the action's permission check: it
performs no action, it only reports one that already committed. Replays that
used a paged list to find their entity (activity creation) now read the one
entity directly, so a back-dated activity on a busy record is still found.

## What stays as it was

- **PATCH and other versioned operations carry no idempotency key.** BR-091
  names create, transfer, submit and upload finalization; those, and every
  other create-style or transition operation, are keyed. A repeated versioned
  write is caught by its version: the retry is a 409, never a second change
  or a second audit event. The client offers reload.
- **Directory and reporting audit events have no screen.** Organization and
  contact identity edits (`directory`) and CSV exports (`reporting`) are
  audited but belong to no single opportunity, so they never appear in an
  opportunity's history, and they are not administrative. The requirements
  ask for the audit, not a view; who should see an export log is a question
  for Penta, not something to infer.
- **Issuing a sign-in link is not deduplicated.** A retry after a lost
  response must produce a link the administrator can actually see, so it
  issues a fresh one and spends the earlier unused link (only the newest
  works); each issuance is audited.
