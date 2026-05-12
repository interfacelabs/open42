-- pre-prod: truncate stale rows before column shape changes
DO $$ BEGIN
  IF to_regclass('public.ingest_jobs') IS NOT NULL THEN
    TRUNCATE TABLE "ingest_jobs";
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."connection_kind" AS ENUM('notion-composio', 'notion-zip');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."connection_status" AS ENUM('pending_import', 'active', 'paused', 'completed', 'errored', 'disconnected');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."ingest_mode" AS ENUM('import_once', 'periodic_pull');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."ingest_status" AS ENUM('pending', 'running', 'completed', 'failed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."membership_role" AS ENUM('owner', 'member');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."skill_type" AS ENUM('refund-policy');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."workspace_status" AS ENUM('provisioning', 'ready', 'failed', 'deleted');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "connection_init_states" (
	"state" text PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "connection_kind" NOT NULL,
	"composio_pending_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" "connection_kind" NOT NULL,
	"status" "connection_status" DEFAULT 'pending_import' NOT NULL,
	"display_name" text NOT NULL,
	"composio_connected_account_id" text,
	"cursor" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_pulled_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ingest_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"gbrain_job_id" text,
	"status" "ingest_status" DEFAULT 'pending' NOT NULL,
	"pages_total" integer DEFAULT 0 NOT NULL,
	"connectors_summary" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "memberships" (
	"user_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"role" "membership_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_user_id_workspace_id_pk" PRIMARY KEY("user_id","workspace_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"csrf_token" text NOT NULL,
	"user_agent" text,
	"ip_first_octet" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "skill_exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"skill_type" "skill_type" NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"citations_count" integer NOT NULL,
	"source_pages_oldest_at" timestamp with time zone,
	"staleness_warning" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supabase_user_id" text,
	"email" text NOT NULL,
	"current_workspace_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_supabase_user_id_unique" UNIQUE("supabase_user_id"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"fly_machine_id" text,
	"fly_private_ip" text,
	"gbrain_base_url" text,
	"gbrain_oauth_client_id" text,
	"gbrain_oauth_client_secret_ciphertext" "bytea",
	"gbrain_version" text NOT NULL,
	"status" "workspace_status" DEFAULT 'provisioning' NOT NULL,
	"ingest_mode" "ingest_mode" DEFAULT 'periodic_pull' NOT NULL,
	"ingest_interval_hours" integer DEFAULT 1 NOT NULL,
	"ingest_last_cycle_at" timestamp with time zone,
	"ingest_lock_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "workspaces_ingest_interval_hours_range" CHECK ("workspaces"."ingest_interval_hours" BETWEEN 1 AND 168)
);
--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "ingest_mode" "ingest_mode" DEFAULT 'periodic_pull' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "ingest_interval_hours" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "ingest_last_cycle_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "ingest_lock_until" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_ingest_interval_hours_range" CHECK ("workspaces"."ingest_interval_hours" BETWEEN 1 AND 168);
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "ingest_jobs" DROP COLUMN IF EXISTS "connector";--> statement-breakpoint
ALTER TABLE "ingest_jobs" DROP COLUMN IF EXISTS "pages_processed";--> statement-breakpoint
ALTER TABLE "ingest_jobs" ADD COLUMN IF NOT EXISTS "connectors_summary" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
DROP TYPE IF EXISTS "public"."connector_kind";--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "connection_init_states" ADD CONSTRAINT "connection_init_states_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "connection_init_states" ADD CONSTRAINT "connection_init_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "connections" ADD CONSTRAINT "connections_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ingest_jobs" ADD CONSTRAINT "ingest_jobs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "memberships" ADD CONSTRAINT "memberships_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "skill_exports" ADD CONSTRAINT "skill_exports_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "skill_exports" ADD CONSTRAINT "skill_exports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "connection_init_states_expires_idx" ON "connection_init_states" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "connections_workspace_status_idx" ON "connections" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "connections_one_notion_per_workspace" ON "connections" USING btree ("workspace_id") WHERE "connections"."kind" IN ('notion-composio', 'notion-zip') AND "connections"."status" <> 'disconnected';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "connections_composio_account_uniq" ON "connections" USING btree ("composio_connected_account_id") WHERE "connections"."composio_connected_account_id" IS NOT NULL AND "connections"."status" <> 'disconnected';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ingest_jobs_workspace_idx" ON "ingest_jobs" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ingest_jobs_status_idx" ON "ingest_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memberships_workspace_idx" ON "memberships" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sessions_expires_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "skill_exports_workspace_idx" ON "skill_exports" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "skill_exports_generated_idx" ON "skill_exports" USING btree ("generated_at");
