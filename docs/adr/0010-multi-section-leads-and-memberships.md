# ADR 0010 — Multi-section leads and section memberships (CR4, CR5)

Status: accepted for implementation, 12 October 2026. Supersedes the
single-section parts of ADR 0004.

## Context

Release one modelled one section per person: `users.section_id`, with
`users.role = 'lead'` marking the section's lead. A partial unique index
allowed at most one active lead per section. Change requests CR4 and CR5
replace that model:

- **CR4.** A section lead can lead several sections, and every active section
  must have exactly one active lead.
- **CR5.** A salesperson can belong to several sections, and each opportunity
  belongs to exactly one section.

The access rules are:

| Role | Access |
| --- | --- |
| Management | All commercial records |
| Lead | Records in the sections they currently lead |
| Salesperson | Their own records, in their current sections |
| Administrator | Administration only |

Historic authorship or former membership never grants access.

## Decision

### Data

- **Lead.** `sections.lead_user_id` is the single source of truth for who
  leads a section. One person may be the lead of many sections.
- **Membership.** `section_memberships` holds a salesperson's sections. A row
  is ended, never deleted; the runtime role has no DELETE on the table. Only
  open rows count, and an open row may exist at most once per user and section.
- **One active lead.** Two layers enforce "an active section has exactly one
  active lead":
  - a CHECK: an active section has a lead pointer;
  - a deferred constraint trigger on `sections` and on `users`: the lead
    pointer names an active account with the lead role.

  The trigger is deferred so a replacement can swap leads inside one
  transaction; it runs at commit and re-reads current rows. These are the
  first triggers in the schema. The rule spans two tables, which a CHECK
  cannot express. The services refuse first, with a readable reason; the
  trigger is the backstop.
- **`users.section_id`** is kept but neither read nor written. The Drizzle
  property is renamed `legacySectionId`, so any new read is easy to spot in
  review. It is dropped in a later migration once staging has verified the
  change.

### Scope

All scope rules stay in `server/policy/scope.ts`:

- **Lead.** `opportunities.section_id IN actor.sectionIds`, where
  `actor.sectionIds` lists the active sections the lead leads. The list is
  read fresh on every request.
- **Salesperson.** `owner_id = actor.id AND section_id IN actor.sectionIds`,
  where the list holds active sections with an open membership. The
  membership condition is new and fails closed: a record left in a section
  the person no longer belongs to is not visible to them, even if they still
  own it.
- **Other users.** For people other than the requester (alert recipients,
  follow-up assignees, eligible owners), the same rules are written as SQL:
  `leadsSectionSql`, `memberOfSectionSql` and `worksInSectionSql`. The test
  that `userSeesOpportunitySql` agrees with `opportunityScope` for every
  account is kept.

### Ownership

- **Eligible owner.** The owner of a record in section S is either an active
  salesperson with an open membership of S, or S's lead. The actor must also
  work in S, unless the actor is management.
- **Create.** The service checks owner and section, then share-locks the
  owner's account and checks again inside the transaction. Before this,
  create did not lock the owner, so a concurrent role or membership change
  could slip through.
- **Transfer.** The request names an owner and, optionally, a section:
  - if the new owner works in the record's current section, it is kept;
  - if the new owner has exactly one possible section, that one is used;
  - otherwise the request must say which section.

  A lead may move a record between two sections they lead (D-CR4-2).
- **Leaving a section.** No one leaves a section, or a selling role, while
  they own records there, open or closed (BR-051 as amended, D-CR5-2).

### Administration

- **Users.** A salesperson is created and edited with `sectionIds` (one or
  more active sections). A lead is created with no sections and gets them by
  appointment. A salesperson's reporting line is the lead of each of their
  sections; no manager is stored for them. A lead's manager is a management
  account.
- **New section.** It is created with its lead, who must already be an active
  lead (CR4).
- **Replace lead.** The new lead is either an existing lead, who keeps their
  other sections, or a salesperson member, who is promoted and whose
  memberships end. The outgoing lead keeps their other sections. If this was
  their only section, they become a salesperson member of it (D-CR4-4).
  Otherwise they must own nothing in it.
- **Deactivating a section.** Refused while it has open records or active
  members. The lead pointer is kept as history and grants nothing, because
  scope reads active sections only. On reactivation the former lead resumes,
  or another lead is named.
- **Sessions.** A role change, or the loss of a section, bumps
  `session_version` (SEC-005). Gaining a section does not sign anyone out;
  scope is re-read on every request anyway.
- **Audit.** Membership changes are audited one section at a time, as
  `account.section_joined` and `account.section_left`, so the history shows
  section names. `account.manager_changed` is no longer written, because
  salespeople's reporting lines are no longer stored.

## Consequences

- Scope queries gain an `IN` list for leads and salespeople, and correlated
  `EXISTS` subqueries for other users. Indexes back these:
  - `sections_lead_idx`;
  - partial indexes on open memberships.

  The capacity measurement should be repeated on staging.
- **Rollback.** Migration 0008 rolls back cleanly only before any account or
  section is changed through the new code, because new memberships and lead
  pointers are not mirrored into `users.section_id`.
- **Base fixtures.** The synthetic fixtures are unchanged, so every earlier
  scope test still describes the same data. A backfill-equivalence test
  proves each seeded account sees exactly what the single-section rules gave
  it. Multi-section scenarios are built inside `server/tests/sections.test.ts`.
