-- Milestone 3, migration 0003: invitations and password recovery (SEC-030).
--
-- Additive: one table, one enum, and password_hash becomes nullable so an
-- invited account can exist before it sets a password. A null hash never
-- authenticates. The runtime role receives CRUD on account_tokens through the
-- default privileges granted in 0001.
--
-- Rollback (only while no account is still awaiting its invitation, because
-- restoring NOT NULL fails on a null password_hash):
--   DROP TABLE account_tokens;
--   DROP TYPE account_token_purpose;
--   ALTER TABLE users ALTER COLUMN password_hash SET NOT NULL;
--   DELETE FROM drizzle.__drizzle_migrations
--     WHERE created_at = (SELECT max(created_at) FROM drizzle.__drizzle_migrations);

CREATE TYPE "public"."account_token_purpose" AS ENUM('invitation', 'password_reset');--> statement-breakpoint
CREATE TABLE "account_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" "account_token_purpose" NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "account_tokens" ADD CONSTRAINT "account_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_tokens" ADD CONSTRAINT "account_tokens_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_tokens_hash_unique" ON "account_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "account_tokens_user_idx" ON "account_tokens" USING btree ("user_id","purpose");