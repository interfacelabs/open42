CREATE TYPE "workspace_invite_status" AS ENUM('pending', 'accepted', 'revoked');--> statement-breakpoint
CREATE TYPE "workspace_plan" AS ENUM('starter', 'team', 'business');--> statement-breakpoint
CREATE TABLE "workspace_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"workspace_id" uuid NOT NULL,
	"email" text NOT NULL,
	"invited_by_user_id" uuid NOT NULL,
	"role" "membership_role" DEFAULT 'member'::"membership_role" NOT NULL,
	"status" "workspace_invite_status" DEFAULT 'pending'::"workspace_invite_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "name" text DEFAULT 'Untitled workspace' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "plan" "workspace_plan";--> statement-breakpoint
DROP INDEX "connections_one_notion_per_workspace";--> statement-breakpoint
CREATE UNIQUE INDEX "connections_one_notion_per_workspace" ON "connections" ("workspace_id") WHERE "kind" IN ('notion-composio', 'notion-zip') AND "status" <> 'disconnected';--> statement-breakpoint
DROP INDEX "connections_composio_account_uniq";--> statement-breakpoint
CREATE UNIQUE INDEX "connections_composio_account_uniq" ON "connections" ("composio_connected_account_id") WHERE "composio_connected_account_id" IS NOT NULL AND "status" <> 'disconnected';--> statement-breakpoint
CREATE INDEX "workspace_invites_workspace_idx" ON "workspace_invites" ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_invites_pending_email_uniq" ON "workspace_invites" ("workspace_id","email") WHERE "status" = 'pending';--> statement-breakpoint
ALTER TABLE "workspace_invites" ADD CONSTRAINT "workspace_invites_workspace_id_workspaces_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "workspace_invites" ADD CONSTRAINT "workspace_invites_invited_by_user_id_users_id_fkey" FOREIGN KEY ("invited_by_user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "workspaces" DROP CONSTRAINT "workspaces_ingest_interval_hours_range", ADD CONSTRAINT "workspaces_ingest_interval_hours_range" CHECK ("ingest_interval_hours" BETWEEN 1 AND 168);