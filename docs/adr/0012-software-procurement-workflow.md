# ADR 0012 — Software Procurement, EOI then RFP (CR6)

Status: accepted, 12 October 2026, revised the same day. The first design
(migration 0010) was superseded by Penta's step 5 instruction. That
instruction asks for procurement milestones kept distinct from the
opportunity pipeline, in a separate area like the Tender Tracker, so it
replaces D-CR6-2 and D-CR6-4. Migration 0011 implements this revision and
retires 0010's structures.

## Context

CR6 asks Penta to track software procurements that run an EOI (Expression of
Interest), shortlisting, and then an RFP (Request for Proposal), alongside
goods tenders, without disturbing the tender workflow or its records.

**First design (0010, superseded):**

- a Workflow field on each opportunity;
- eight procurement stages added to the opportunity pipeline;
- an EOI/RFP phase on tender notices.

**Revised instruction (Penta, step 5):**

- **Area.** A separate Software Procurement area, in the Tender Tracker's
  patterns.
- **Cycles.** Cycles linked to an opportunity, inheriting its owner, section,
  permissions and documents. Several per opportunity, at most one current.
  The route is explicit, and nothing is classified from titles.
- **Milestones.** EOI preparation/publication → EOI submitted → Shortlisted
  or Not shortlisted → RFP received → Proposal preparation → Proposal
  submitted → Evaluation → Awarded, Unsuccessful or Cancelled.
- **The pipeline.** Milestones stay distinct from it. Pipeline changes are
  offered explicitly, under the existing award and loss rules.
- **Fields.** EOI and RFP fields, clarification deadline, submission method,
  participation, and separate technical and financial submissions. Links to
  EOI, shortlist, RFP, proposal and decision documents. Later-stage fields
  are allowed while at EOI and required on advancing.
- **Late submissions** are recorded explicitly, never hidden by moving a
  deadline. Dates follow Asia/Dhaka.
- **Shortlisting** is required before the RFP, except for a documented,
  management-only direct RFP exception that never invents an EOI.
- **Shared controls.** Version checks, retry protection, transactions, audit,
  and secure document storage and scanning.
- **Views.** Filters, overdue and upcoming deadlines, stage history,
  dashboard, report and export, with EOI and RFP submissions distinguishable
  from goods tenders.
- **Notifications** are left for a later step.

## Decision

### Storage (migration 0011)

- **`procurement_cycles`.** One row per cycle, holding:
  - the opportunity, the procuring organization, title and reference;
  - `route` (`eoi_rfp` | `direct_rfp`) and `milestone`, plus `is_current`
    (a partial unique index allows one current cycle per opportunity);
  - EOI fields: publication date, deadline, submitted at, late note,
    shortlisting outcome and its date;
  - RFP fields: reference, invitation date, clarification deadline,
    proposal deadline, and `proposal_format` (`single` | `separate`) with
    one submitted-at, or technical and financial submitted-at, and a late
    note;
  - submission method, participation (`undecided` / `participating` /
    `not_participating`) and its reason;
  - the direct-RFP reason and approver; the outcome date and note; notes;
    the version.
- **CHECKs** make the wrong states unrepresentable:
  - each milestone's required facts are present;
  - the RFP comes only after shortlisting on the EOI route;
  - a direct RFP is documented and carries no EOI fields or EOI milestones;
  - a submission after its deadline has a late note;
  - an ending is dated, and a cancellation says why.
- **Link tables.** `procurement_cycle_contacts` and
  `procurement_cycle_documents` (with a role: EOI, shortlist, RFP, proposal
  or decision) link to the opportunity's own contacts and documents. The
  documents keep their storage, scanning, revisions and access.
- **Runtime role.** It cannot delete cycles. It can delete links, and the
  audit records every link and unlink.
- **Retiring 0010.** `opportunities.workflow`, `tenders.phase` and the
  tender EOI-outcome columns are dropped, with their constraints and types.
  The eight pipeline stage values and the `closed` notice state cannot be
  dropped from their enum types. New CHECKs (`opportunities_stage_live`,
  `tenders_notice_state_live`) refuse them, and the schema types the columns
  with the live lists only. `not_shortlisted` stays as an ordinary lost
  reason.
- **Pre-flight.** The migration refuses to run, changing nothing, if any
  record still uses what 0010 added. It converts nothing automatically.

### Rules (`server/services/procurement.ts`)

- **Order.**
  - A cycle moves forward only: `nextMilestones` in `shared/enums.ts`.
  - Not shortlisted is reachable once the EOI is submitted; Awarded or
    Unsuccessful once the proposal is submitted; Cancelled from any open
    milestone.
  - An ended cycle is history.
  - A closed opportunity's cycle can only be brought to its ending.
- **Facts on advancing.** The facts a milestone needs are given with it, or
  must already be recorded:
  - the EOI submission;
  - the shortlisting date;
  - the RFP's reference, invitation date and proposal deadline;
  - the proposal submission, or both its parts;
  - the outcome date.

  A submission cannot be in the future or before its notice. It can be
  after its deadline only with a note. A recorded submission freezes its
  deadline. Recording a submission sets the participation to Participating,
  and is refused when the participation is Not participating.
- **The pipeline.** A milestone may offer one stage
  (`PROCUREMENT_PIPELINE_OFFERS`):
  - RFP received → Tender Published;
  - Proposal preparation → Bid Preparation;
  - Proposal submitted → Bid Submitted;
  - Evaluation → Evaluation;
  - Awarded → Awarded;
  - Unsuccessful or Not shortlisted → Lost.

  Only an explicit acceptance moves the opportunity, through
  `changeStageInTransaction`: the same rules, audit and follow-up effects as
  the stage-change endpoint, in the same transaction.
- **Direct RFP.** Only management may create one (`canApproveDirectRfp` in
  `scope.ts`), with a reason. It starts at RFP received; the owner then works
  it as usual.
- **Reissue.** A new cycle requires the current one to have ended (for
  example Cancelled). The earlier cycle stays, no longer current.
- **Access.** Every read goes through the opportunity's scope, and every
  write locks the opportunity, then the cycle. An inaccessible cycle,
  contact or document is the standard 404. A transfer moves everything
  with no write here.

### Views

- **The Software Procurement area** (`/procurement`): the Tender Tracker's
  layout, with search and filters for milestone, route, owner, section, the
  open-deadline window (overdue, 72 hours, 7 days) and current or all
  cycles. The indicator comes from the server, and the legend explains it.
- **The opportunity's Software Procurement tab:**
  - the current cycle, with Record milestone (asking about the pipeline as
    Mark Submitted does) and Edit;
  - linked documents and contacts;
  - stage history from the audit, ordered by `(occurred_at, sequence)`;
  - earlier cycles.
- **Metrics** (`metrics.ts`):
  - `procurementOpenDeadline` (the EOI deadline while in preparation, then
    the proposal deadline until submission);
  - `workingProcurementCycle`, `procurementDueWithin` and
    `procurementOverdue`.

  The dashboard panel (shown only where cycles are in progress), the
  "Software procurement deadlines" report and its CSV export compose these,
  inside the scope predicate. Goods-tender metrics and reports are
  unchanged, so the two kinds of submission are never mixed.
- **Notifications** for procurement deadlines are not built yet, as
  instructed.

## Consequences

- **Production upgrade.** Apply 0011 after 0010. If 0010 was applied and
  Software Procurement records were created under it, they must be closed
  or corrected first; the pre-flight check names them.
- **Retired enum values.** The eight stage values and `closed` remain in
  their enum types, refused by CHECKs, until a future type rebuild.
- **Rollback** of 0011 is clean only before any cycle exists. See its header.
