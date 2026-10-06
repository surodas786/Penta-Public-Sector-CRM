# ADR 0005 — Organization directory, contacts and activities

**Status:** Accepted (Milestone 4)
**Date:** 05 October 2026
**Requirements:** FR-030–FR-033, FR-040, FR-041, BR-020, BR-021, BR-080, SEC-002, SEC-004

## Contacts are visible only through links

`contactScope(actor)` in `server/policy/scope.ts` is a SQL predicate: a contact
is visible when it has a **live link to an opportunity the actor can see**, and
it reuses `opportunityScope` for that test. Management sees every contact.
Because visibility is derived on each request from the opportunity, an
ownership transfer changes who sees a contact on the next request, with no
separate bookkeeping — the contact portion of AT-08 is a consequence, not a
special case.

Within a visible contact, only the links whose opportunities the actor can see
are returned, each with its own relationship notes. Inaccessible links are not
returned, counted or named. A mutation test confirmed this filter is
load-bearing: without it the contact view returned two or three links instead
of one.

## Relationship notes live on the link

The contact record has **no notes field**. Anything about a relationship is
stored on the opportunity-contact link (BR-020), so a contact shared by two
teams never carries one team's commentary to the other. The demo kept one
note per contact; the synthetic seed places each demo note on the contact's
first link only (documented in `server/db/seedDirectory.ts`), because copying
it to every link would leak it across teams.

## Who may edit what (BR-021)

- **Relationship notes:** anyone who can see that link's opportunity.
- **Shared identity** (name, designation, organization, department, email,
  phone): only someone who can see **every** live link — management always,
  a lead when all links are in their section, a salesperson only when every
  link is theirs. Others get a 403 that tells them management can correct it.
  This necessarily reveals one bit — that the contact is also linked
  elsewhere — and nothing more.
- **Archive** (organization or contact): management only.

## Links are kept, never deleted

A removed link is marked removed (with who and when) and keeps its notes. At
most one live link per pair is enforced by a partial unique index (BR-080).
A contact's **last** live link cannot be removed (FR-033: that is management's
explicit archive decision); concurrent removals are serialised by locking the
contact row, and a mutation test showed both removals succeed without it.

## Activities

- Read and written only through the parent opportunity's scope: an author
  whose record was transferred away gets a 404. Authorship is history, not
  access (FR-041, AT-03).
- Salespeople amend only activities they authored; leads and management
  amend any in scope. Each edit bumps the version, records who and when, and
  writes the before/after values to the append-only audit.
- **Never deleted**: migration 0004 removes DELETE and TRUNCATE on activities,
  contacts and links from the runtime role; a test asserts PostgreSQL refuses.
- An activity's optional contact must have a live link to the same
  opportunity, share-locked while the activity is written.
- The approved form's optional **next action** is created as a follow-up in
  the same transaction, under the M2 follow-up rules.
- An activity cannot be dated in the future (5-minute clock allowance): it
  records something that happened; future work is a follow-up.

## The directory

- Every sales role reads and maintains basic organization details; the
  administrator has no sales directory (403).
- The only commercial figure — "Your opportunities" — is a correlated count
  through the caller's own scope predicate, so it never includes
  inaccessible records (FR-031).
- **Duplicate names** (ignoring case, spacing and punctuation) return 409
  `possible_duplicate` with the similar names; the user may confirm and save
  anyway (FR-033: a warning, not a block).
- **Parent cycles** are refused by walking up from the proposed parent;
  parent changes are serialised with a transaction-scoped advisory lock so two
  simultaneous edits cannot each create half of a cycle (without the lock the
  test produced a deadlock 500 instead of a clean refusal).
- **Archive** is refused while any open opportunity uses the organization.
  Opportunity creation now takes a share lock on its organization, so a
  record cannot be created against an organization in the instant it is being
  archived.

## Audit domains

`audit_events.domain` gains `directory` for organization and contact
**identity** changes, which belong to no single opportunity. Link and
activity events are `commercial`, carry the opportunity id, and appear in
that opportunity's Change History. Directory events are recorded but not yet
shown anywhere; viewing them is part of the M7 audit work.

## Recorded decisions, for review

- Future-dated activities are refused.
- An archived contact stays readable through its existing links but leaves
  lists and cannot be linked again; there is no unarchive in this release.
- Removing a link is open to anyone who can edit the opportunity.
- An activity on a later-unlinked contact still shows that contact's name on
  the opportunity's timeline (it is part of that opportunity's record), but
  never the contact's details.
