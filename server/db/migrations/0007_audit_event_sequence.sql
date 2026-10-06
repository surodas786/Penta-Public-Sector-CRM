-- Milestone 7, migration 0007: append order for audit events.
--
-- Events written in one transaction can share an occurred_at timestamp (and
-- always do under a frozen test clock), so ordering history by time alone
-- left page boundaries undefined: a row could appear on two pages or on none.
-- History views now order by (occurred_at, sequence), both descending.
--
-- Additive. Existing rows are numbered in physical order when the column is
-- added. The runtime role keeps SELECT and INSERT only on audit_events; an
-- identity column is filled on INSERT and cannot be set by UPDATE.
--
-- Rollback:
--   ALTER TABLE audit_events DROP COLUMN sequence;
--   DELETE FROM drizzle.__drizzle_migrations
--     WHERE created_at = (SELECT max(created_at) FROM drizzle.__drizzle_migrations);

ALTER TABLE "audit_events" ADD COLUMN "sequence" bigint NOT NULL GENERATED ALWAYS AS IDENTITY (sequence name "audit_events_sequence_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1);
