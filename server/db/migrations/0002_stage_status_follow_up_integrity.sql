-- Milestone 2, migration 0002: stage, status and follow-up integrity.
--
-- Additive only: one nullable column and CHECK constraints that existing rows
-- already satisfy (verified against the synthetic fixtures before writing).
-- No new table: stage history is the append-only audit trail (FR-021, BR-012).
--
-- Rollback (reverse order; no data is lost because nothing is rewritten):
--   ALTER TABLE opportunities DROP CONSTRAINT opportunities_held_or_cancelled_explained,
--     DROP CONSTRAINT opportunities_terminal_status_active,
--     DROP CONSTRAINT opportunities_loss_only_when_lost,
--     DROP CONSTRAINT opportunities_award_only_when_awarded,
--     DROP CONSTRAINT opportunities_loss_other_explained,
--     DROP CONSTRAINT opportunities_loss_reason_preset,
--     DROP CONSTRAINT opportunities_lost_requires_outcome,
--     DROP CONSTRAINT opportunities_awarded_requires_outcome;
--   ALTER TABLE follow_ups DROP CONSTRAINT follow_ups_cancelled_consistent,
--     DROP CONSTRAINT follow_ups_completed_consistent,
--     DROP COLUMN cancelled_by;
--   DELETE FROM drizzle.__drizzle_migrations
--     WHERE created_at = (SELECT max(created_at) FROM drizzle.__drizzle_migrations);
-- (Exercised on the development and test databases during M2.)

ALTER TABLE "follow_ups" ADD COLUMN "cancelled_by" uuid;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_completed_consistent" CHECK (("follow_ups"."state" = 'completed') = ("follow_ups"."completed_at" IS NOT NULL AND "follow_ups"."completed_by" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_cancelled_consistent" CHECK (("follow_ups"."state" = 'cancelled') = ("follow_ups"."cancelled_at" IS NOT NULL AND "follow_ups"."cancelled_by" IS NOT NULL AND "follow_ups"."cancellation_reason" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_awarded_requires_outcome" CHECK ("opportunities"."stage" <> 'awarded' OR ("opportunities"."awarded_value" IS NOT NULL AND "opportunities"."awarded_value" > 0 AND "opportunities"."award_date" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_lost_requires_outcome" CHECK ("opportunities"."stage" <> 'lost' OR ("opportunities"."loss_reason" IS NOT NULL AND "opportunities"."closed_date" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_loss_reason_preset" CHECK ("opportunities"."loss_reason" IS NULL OR "opportunities"."loss_reason" IN ('price', 'technical_eligibility', 'competitor_selected', 'budget_unavailable', 'no_bid', 'other'));--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_loss_other_explained" CHECK ("opportunities"."loss_reason" IS DISTINCT FROM 'other' OR "opportunities"."loss_note" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_award_only_when_awarded" CHECK ("opportunities"."stage" = 'awarded' OR ("opportunities"."awarded_value" IS NULL AND "opportunities"."award_date" IS NULL));--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_loss_only_when_lost" CHECK ("opportunities"."stage" = 'lost' OR ("opportunities"."loss_reason" IS NULL AND "opportunities"."loss_note" IS NULL));--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_terminal_status_active" CHECK ("opportunities"."stage" NOT IN ('awarded', 'lost') OR "opportunities"."status" = 'active');--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_held_or_cancelled_explained" CHECK ("opportunities"."status" = 'active' OR "opportunities"."status_note" IS NOT NULL);