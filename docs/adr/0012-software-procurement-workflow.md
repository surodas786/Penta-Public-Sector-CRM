# ADR 0012 — Software Procurement workflow (CR6)

Status: accepted, 12 October 2026, with Penta's decisions on D-CR6-1 to
D-CR6-6.

## Context

CR6 asks for a separate Software Procurement workflow that follows an EOI
(Expression of Interest) and then an RFP (Request for Proposal), alongside the
standard tender workflow. Release one had one linear stage pipeline, and the
procurement method was free text.

Penta confirmed these decisions:

| Decision | Choice |
| --- | --- |
| D-CR6-1 | The workflow tracks the sales pursuit only. It does not submit bids, and no procurement law is built in |
| D-CR6-2 | Stages: Identified → EOI Published → EOI Submitted → Shortlisted → RFP Issued → Proposal Preparation → Proposal Submitted → Technical Evaluation → Financial Evaluation / Negotiation, then the shared Awarded / Lost |
| D-CR6-3 | Not shortlisted ends as Lost, with the preset reason "Not shortlisted" |
| D-CR6-4 | A Workflow field on the opportunity, not a new navigation entry |
| D-CR6-5 | The workflow is fixed at creation |
| D-CR6-6 | Recording the EOI outcome closes the EOI notice; there is still one current notice per opportunity |

## Decision

### Storage (migration 0010)

- **`opportunities.workflow`** (`standard` | `software_procurement`),
  `NOT NULL DEFAULT 'standard'`. Every existing record becomes standard and
  is otherwise unchanged.
- **Stage values.** The eight new stage values are added to the existing
  `opportunity_stage` type, before `awarded`. One stage column keeps every
  query, index and metric working. Identified, Awarded and Lost are shared.
- **CHECK `opportunities_stage_in_workflow`**: a record's stage belongs to
  its workflow. It compares `stage::text`, because PostgreSQL forbids using
  a newly added enum value as a constant in the transaction that adds it; the
  migration and the production script each run as one transaction.
- **Lost reason.** `not_shortlisted` is added to the preset lost reasons,
  and a CHECK allows it only on Software Procurement records.
- **Tenders.**
  - `tenders.phase` (`eoi` | `rfp`): required on a Software Procurement notice
    and refused on a standard one, by the service, because a CHECK cannot see
    the parent record.
  - `eoi_outcome`, `eoi_outcome_date`, and a new notice state `closed`. CHECKs
    keep the outcome on EOIs only, always dated, and a closed notice always
    has an outcome.

### Stage rules

- **One definition.** `WORKFLOW_STAGES` in `shared/enums.ts` holds each
  workflow's ordered stages. `classifyStageMove` measures forward, skip and
  backward moves within the record's workflow.
- **Server checks.** The transition service refuses a stage from the other
  workflow, and a reopening to one.
- **Unchanged rules.** Every other BR-010 to BR-014 rule is unchanged: skips
  and backward moves need an explanation, Awarded needs a value and date,
  Lost needs a reason, and only management reopens.

### Tenders: EOI then RFP

- **Mark Submitted** offers the phase's stage: EOI Submitted for an EOI,
  Proposal Submitted for an RFP, and Bid Submitted (unchanged) for standard.
  `submittedStageFor` and `offersBidSubmittedStage` decide it, with the stage
  mismatch indicator to match.
- **Record EOI outcome.**
  - Allowed only on a current, submitted EOI.
  - It closes the notice and records the outcome and its date.
  - With the user's explicit choice, Shortlisted moves the record on, and Not
    shortlisted closes it as Lost (reason Not shortlisted, closed date = the
    outcome date), cancelling open follow-ups.
  - Both moves use the same `applyStageMove` as the stage-change service, so
    they are audited identically.
  - It is idempotent like Mark Submitted.
- **Order of notices.** An RFP is refused until an EOI on the record is
  recorded Shortlisted, unless the record has no EOI at all (an opportunity
  found at RFP). An EOI cannot follow an RFP.
- **History.** A closed EOI cannot be made current again.

### Views

- **Boards.** Each board shows one workflow's lanes (`boardLanesFor`).
  Opportunities gains a Workflow filter, which is also the board switch.
- **Dashboard stage chart and "Pipeline by stage" report.** They add the
  Software Procurement stages after the standard ones, but only once such
  records are in the population, so a deployment without any looks exactly
  as before.
- **Unchanged metrics.** Active pipeline, overdue, seven-day tenders and
  awarded-this-quarter (`metrics.ts`) only name Awarded and Lost, so they
  cover both workflows unchanged.
- **CSV export** of opportunities gains a Workflow column.

### Access

Unchanged. The workflow never widens or narrows scope.

## Consequences

- **Rollback.** PostgreSQL cannot drop enum values, so rolling back 0010
  leaves the eight stage names in the type, unused. The migration header
  gives the rest of the rollback, which is clean only before any Software
  Procurement record or EOI exists.
- **Future workflows** would add their stages and a `WORKFLOW_STAGES` entry
  the same way.
