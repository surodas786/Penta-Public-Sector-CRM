-- Change request CR6, migration 0010: the Software Procurement workflow
-- (EOI -> RFP), alongside the standard tender workflow.
--
-- Decisions (confirmed by Penta, 12 October 2026): the draft stage list
-- (D-CR6-2); "not shortlisted" ends as Lost with its own preset reason
-- (D-CR6-3); a workflow field on opportunities, no new navigation (D-CR6-4);
-- recording the EOI outcome closes the EOI notice (D-CR6-6).
--
--   * opportunities.workflow, NOT NULL DEFAULT 'standard': every existing
--     record becomes a standard one, so nothing about it changes.
--   * eight new opportunity_stage values, inserted before 'awarded'.
--   * a CHECK that each record's stage belongs to its workflow, written with
--     stage::text so it can be created in the same transaction that adds the
--     values (a new enum value cannot be used as a constant before commit).
--   * the 'not_shortlisted' lost reason, allowed only on Software Procurement.
--   * tenders.phase (eoi | rfp), the EOI outcome and its date, and the
--     notice state 'closed' for an EOI whose outcome is recorded.
--
-- Additive. Existing rows satisfy every new constraint as they are.
--
-- Rollback (only before any Software Procurement record or EOI exists; the
-- new enum values cannot be dropped in PostgreSQL and simply stay unused):
--   ALTER TABLE tenders DROP CONSTRAINT tenders_closed_has_outcome,
--     DROP CONSTRAINT tenders_eoi_outcome_dated, DROP CONSTRAINT tenders_eoi_outcome_on_eoi,
--     DROP COLUMN eoi_outcome_date, DROP COLUMN eoi_outcome, DROP COLUMN phase;
--   ALTER TABLE opportunities DROP CONSTRAINT opportunities_stage_in_workflow,
--     DROP CONSTRAINT opportunities_not_shortlisted_software_only,
--     DROP CONSTRAINT opportunities_loss_reason_preset, DROP COLUMN workflow;
--   ALTER TABLE opportunities ADD CONSTRAINT opportunities_loss_reason_preset CHECK (loss_reason IS NULL
--     OR loss_reason IN ('price', 'technical_eligibility', 'competitor_selected', 'budget_unavailable', 'no_bid', 'other'));
--   DROP INDEX IF EXISTS opportunities_workflow_idx;
--   DROP TYPE eoi_outcome; DROP TYPE tender_phase; DROP TYPE opportunity_workflow;
--   DELETE FROM drizzle.__drizzle_migrations
--     WHERE created_at = (SELECT max(created_at) FROM drizzle.__drizzle_migrations);

CREATE TYPE "public"."eoi_outcome" AS ENUM('shortlisted', 'not_shortlisted');--> statement-breakpoint
CREATE TYPE "public"."opportunity_workflow" AS ENUM('standard', 'software_procurement');--> statement-breakpoint
CREATE TYPE "public"."tender_phase" AS ENUM('eoi', 'rfp');--> statement-breakpoint
ALTER TYPE "public"."notice_state" ADD VALUE 'closed';--> statement-breakpoint
ALTER TYPE "public"."opportunity_stage" ADD VALUE 'eoi_published' BEFORE 'awarded';--> statement-breakpoint
ALTER TYPE "public"."opportunity_stage" ADD VALUE 'eoi_submitted' BEFORE 'awarded';--> statement-breakpoint
ALTER TYPE "public"."opportunity_stage" ADD VALUE 'shortlisted' BEFORE 'awarded';--> statement-breakpoint
ALTER TYPE "public"."opportunity_stage" ADD VALUE 'rfp_issued' BEFORE 'awarded';--> statement-breakpoint
ALTER TYPE "public"."opportunity_stage" ADD VALUE 'proposal_preparation' BEFORE 'awarded';--> statement-breakpoint
ALTER TYPE "public"."opportunity_stage" ADD VALUE 'proposal_submitted' BEFORE 'awarded';--> statement-breakpoint
ALTER TYPE "public"."opportunity_stage" ADD VALUE 'technical_evaluation' BEFORE 'awarded';--> statement-breakpoint
ALTER TYPE "public"."opportunity_stage" ADD VALUE 'financial_evaluation' BEFORE 'awarded';--> statement-breakpoint
ALTER TABLE "opportunities" DROP CONSTRAINT "opportunities_loss_reason_preset";--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "workflow" "opportunity_workflow" DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenders" ADD COLUMN "phase" "tender_phase";--> statement-breakpoint
ALTER TABLE "tenders" ADD COLUMN "eoi_outcome" "eoi_outcome";--> statement-breakpoint
ALTER TABLE "tenders" ADD COLUMN "eoi_outcome_date" date;--> statement-breakpoint
CREATE INDEX "opportunities_workflow_idx" ON "opportunities" USING btree ("workflow");--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_stage_in_workflow" CHECK ("opportunities"."stage"::text IN ('awarded', 'lost') OR ("opportunities"."workflow" = 'standard' AND "opportunities"."stage"::text IN ('identified', 'initial_engagement', 'requirements_discussion', 'awaiting_tender', 'tender_published', 'bid_preparation', 'bid_submitted', 'evaluation')) OR ("opportunities"."workflow" = 'software_procurement' AND "opportunities"."stage"::text IN ('identified', 'eoi_published', 'eoi_submitted', 'shortlisted', 'rfp_issued', 'proposal_preparation', 'proposal_submitted', 'technical_evaluation', 'financial_evaluation')));--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_not_shortlisted_software_only" CHECK ("opportunities"."loss_reason" IS DISTINCT FROM 'not_shortlisted' OR "opportunities"."workflow" = 'software_procurement');--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_loss_reason_preset" CHECK ("opportunities"."loss_reason" IS NULL OR "opportunities"."loss_reason" IN ('price', 'technical_eligibility', 'competitor_selected', 'budget_unavailable', 'no_bid', 'not_shortlisted', 'other'));--> statement-breakpoint
ALTER TABLE "tenders" ADD CONSTRAINT "tenders_eoi_outcome_on_eoi" CHECK ("tenders"."eoi_outcome" IS NULL OR "tenders"."phase" = 'eoi');--> statement-breakpoint
ALTER TABLE "tenders" ADD CONSTRAINT "tenders_eoi_outcome_dated" CHECK (("tenders"."eoi_outcome" IS NULL) = ("tenders"."eoi_outcome_date" IS NULL));--> statement-breakpoint
ALTER TABLE "tenders" ADD CONSTRAINT "tenders_closed_has_outcome" CHECK ("tenders"."notice_state"::text <> 'closed' OR "tenders"."eoi_outcome" IS NOT NULL);
