# ADR 0004 — Ownership transfers, account administration and invitations

**Status:** Accepted for development (Milestone 3). Invitation and recovery are
replaced, not extended, if Penta's identity provider is adopted (ADR 0002).
**Date:** 05 October 2026
**Requirements:** FR-070, FR-071, BR-002, BR-050–BR-052, BR-090, BR-091, SEC-005, SEC-012, SEC-030–SEC-032

## Transfers

**One service, one lock order.** `POST /api/opportunities/:id/transfer` is
the only way an owner or section changes; the basic-edit PATCH still refuses
those fields with 403. The transaction locks the opportunity row first (the
order every M2 writer uses), then the new owner's user row, then the open
follow-ups. A transfer and a concurrent task completion are therefore
serialised: there is no interleaving in which an open task stays with the
previous owner (BR-090; tested with concurrent connections).

**Who may transfer whom.** The acceptable new owners are exactly
`eligibleOwnerScope(actor)`: a lead's own section, any section for management,
nobody for a salesperson (403 on a visible record). The same predicate feeds
the owner lookup, so the dialog can only offer what the server accepts.

**Open follow-ups (BR-050).** `keepsFollowUpAfterTransfer` in
`server/policy/scope.ts` decides, task by task: the previous owner's tasks
always move to the new owner; anyone else keeps a task only if they will still
see the record — management, the new section's lead, or the new owner.
Completed and cancelled tasks keep their assignee as history. Each move is
audited.

**Locking the new owner's row** also serialises a transfer against the
administrator deactivating that person, so a deactivation cannot miss a
transfer committed a moment earlier, and a transfer cannot pick an owner who
was deactivated a moment earlier.

**Closed records can be transferred**, so historical ownership can move before
an owner leaves (BR-051).

## Administration

**The administrator sees structure, never commerce.** No opportunity names,
counts or values in any administration response. Where commercial state blocks
an action ("owns open opportunities") the refusal says so without quantifying.

**Invariants, each enforced under row locks in one transaction:**

| Rule | Behaviour |
| --- | --- |
| A salesperson reports to their section's active lead (BR-002) | Derived by the server on create, update and reactivation; a different `managerId` is a 422 |
| One active lead per section (FR-002) | Creating or promoting a second lead is a 409 pointing to Replace lead; the partial unique index from 0001 backs it |
| Owner/section consistency (BR-051) | A role or section change is refused while the person owns any opportunity, open or closed. Lead ↔ salesperson within the same section is allowed: both remain eligible owners there |
| Deactivation (BR-051) | Refused while the person owns open work (Active or On Hold, not Awarded/Lost/Cancelled). Closed records stay with the inactive person as historical owner |
| The only lead of an active section (BR-052) | Cannot be deactivated or moved; Replace lead promotes a salesperson of that section, demotes the old lead to salesperson in the same section, and re-points every salesperson — atomically |
| Section deactivation (BR-052) | Refused while it has open opportunities or active members |
| Last administrator | Every account change first locks all active administrator rows in id order, so two administrators acting on each other are serialised and cannot deadlock |
| Self-promotion (BR-052) | No account changes its own role or deactivates itself |
| SEC-005 | Role or section changes, deactivation and password changes bump the session version; live sessions end on their next request |

**Privileged role changes are their own audit event** (`account.role_changed`).
All administrative events use the `administrative` audit domain and never
carry an opportunity id; commercial history never shows them.

## Invitations and password recovery (SEC-030)

Release one sends no email (requirements §1.3), and no identity provider is
configured. So:

- An account is created **without a password**. A null hash never
  authenticates; sign-in spends the same work as for an unknown address.
- The administrator receives a **single-use link, once**, and delivers it out
  of band. The token is 256 random bits; only its SHA-256 hash is stored; it
  expires (72 h for an invitation, 24 h for a reset — proposed defaults);
  issuing a new link spends the previous one; deactivation spends all.
- The token travels in the URL **fragment**, which browsers never send to a
  server or in a Referer header, and the page removes it from the address bar
  once read.
- Redeeming it sets the password, spends the token and revokes every session,
  in one transaction. Every failure — unknown, used, expired, inactive
  account — returns the same 422 message.
- `POST /api/auth/set-password` is CSRF-protected and has its own rate limiter
  (same defaults as sign-in), so recovery attempts do not consume sign-in
  attempts and vice versa.
- Minimum password length is 12, no composition rules — a proposal for Penta
  to confirm.

**Self-service "forgot password" is not offered**: without email delivery it
would either disclose account existence or do nothing. The sign-in page tells
people to contact the administrator.

## Logging (SEC-032)

The fallback error logger printed the whole error object. For a failed
database query that includes the bound parameters — business notes, emails,
and in M3 password and token hashes. It now logs the error type, SQLSTATE,
constraint and the statement's opening only, plus the request id. A test
induces a query failure with distinctive request text and checks the log; the
same test fails against the previous logger.

## Open for Penta

1. Identity provider and MFA for privileged roles (unchanged from ADR 0002).
2. Link lifetimes (72 h / 24 h) and the 12-character minimum.
3. Whether Team Management should also be offered to section leads for their
   own section (the permission matrix allows "own section"; FR-011 names
   management only, so leads do not see it in this release).
