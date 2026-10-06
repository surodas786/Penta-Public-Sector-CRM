# ADR 0003 — Stage, status and follow-up lifecycle

**Status:** Accepted (Milestone 2)
**Date:** 05 October 2026
**Requirements:** FR-020, FR-021, FR-042, FR-043, BR-010–BR-014, BR-030, BR-090, BR-091, D-001, D-003, D-004

## Context

Milestone 2 makes stage and status changes persistent and adds the complete
follow-up lifecycle. Three properties must hold under concurrent use:

1. Every Active, nonterminal opportunity has at least one open follow-up,
   because open follow-ups are the only source of the next action (BR-013).
2. Outcomes are complete and consistent: Awarded has an actual value and date,
   Lost has a preset reason and date, and a reopened record carries no stale
   outcome (BR-011, BR-012).
3. A retried or double-clicked request is applied once, and a stale one is
   refused rather than overwriting newer state (BR-090, BR-091, BR-030).

## Decisions

### Dedicated operations, not a generic PATCH

Stage, status and reopening are separate endpoints
(`POST /api/opportunities/:id/stage`, `/status`, `/reopen`), and follow-ups have
`/complete`, `/reschedule` and `/cancel`. The basic-edit PATCH still refuses
these fields with 403. Each operation therefore owns its own required fields,
permission and audit shape, and none can be reached by mass assignment.

### One lock order: opportunity, then follow-up

Every M2 writer begins its transaction with `SELECT … FOR UPDATE` on the
opportunity row, located through the actor's scope predicate, and only then
locks a follow-up. This serialises:

- two completions of an opportunity's last two open tasks — the second sees
  that its task has become the last and must supply a replacement;
- a completion racing a terminal transition — the task ends either Completed
  (if completion ran first) or Cancelled by the closure, never open and never
  both.

The version is compared after the lock *and* kept in the UPDATE predicate, so a
stale write is a 409 even if a future code path skips the explicit check. The
M3 transfer service must take the same lock first (BR-090: a transfer and a
simultaneous task completion must not leave tasks assigned to the old owner).

A mutation test confirmed the lock is load-bearing: with `FOR UPDATE` removed,
the concurrent-completion test fails with both requests succeeding and the
record left with no next action.

### Database constraints as the last line

Migration `0002` adds CHECK constraints that make inconsistent outcomes
unrepresentable even if a future path bypasses the services: Awarded requires
a positive value and a date; Lost requires a preset reason and a date, and
"Other" requires an explanation; outcome fields exist only on the matching
stage; a terminal record is always Active; On Hold and Cancelled carry an
explanation; a Completed follow-up records who and when, and a Cancelled one
records who, when and why — a task can never be both.

Writing these surfaced a real trap, now covered by a test: `awarded_value > 0`
evaluates to NULL for a missing value, and a CHECK that evaluates to NULL
passes. The constraint tests `IS NOT NULL` first.

### History is the audit trail

No separate stage-history table was added. Every transition writes an
append-only `audit_events` row in the same transaction, with before and after
values and the reason. Reopening records the previous outcome in the event's
before-values before clearing it from the record, which satisfies "keep the
previous outcome in immutable history" without a second store that could
disagree with the audit. Follow-up events carry the opportunity id, so the
Change History tab shows them alongside stage changes, with the task named.

### Idempotency on every M2 mutation

All M2 mutations require an `Idempotency-Key`. The fingerprint covers the
record id as well as the body, so a key cannot be replayed against a different
record. The claim is now completed **inside** the business transaction
(`runIdempotent` in `server/services/idempotency.ts`); previously it was marked
complete after the commit, leaving a window in which a crash stranded the key
as "in progress" for 24 hours although the change had been saved. Opportunity
creation uses the same helper.

### Rules chosen where the requirements leave room

Each is a recorded implementation decision, not a new requirement:

- **Moves to Awarded or Lost are not "skips".** They need their outcome fields,
  not a skip explanation; any working stage may close.
- **A held or cancelled record changes stage only by returning to Active**,
  which restores the retained stage (D-001). Dragging it to another stage lane
  is refused with that explanation.
- **Cancelled → On Hold is refused**; return to Active first.
- **A closed date cannot be in the future**, matching the stated rule for the
  award date.
- **Cancelling sets the closed date to today** (Dhaka), consistent with the
  synthetic fixtures; returning to Active clears it.
- **Closed records stay read-only for basic edits.** Correcting one means
  reopening it (management) or returning it to Active, so every change to a
  closed record passes through an audited, reasoned transition.
- **Creation stays nonterminal.** A historical outcome is entered by creating
  the record and then recording the outcome as a stage change.
- **Follow-ups can be added while On Hold**, not while Cancelled or closed.
- **Assignment eligibility** (FR-042, D-004): salesperson → self; lead → owner
  or self; management → owner, the section's lead, or a management account.
  All must be active. With no assignee given, the owner is used if eligible,
  otherwise the actor — which covers a record whose owner has left.

## Consequences

- The board is bounded per lane (50 cards) with server-computed lane counts and
  values; "N more — use the Table view" appears beyond that.
- A follow-up list endpoint (`GET /api/follow-ups`) computes Today, Overdue and
  Upcoming in SQL against `dhakaToday()`, so the browser clock never decides
  what is overdue.
- Notifications that depend on follow-up dates (M6) must be invalidated by the
  reschedule, complete and cancel operations introduced here.
