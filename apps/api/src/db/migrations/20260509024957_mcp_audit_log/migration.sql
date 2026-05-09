CREATE TABLE "mcp_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"workspace_id" uuid NOT NULL,
	"caller_user_id" uuid,
	"tool_name" text NOT NULL,
	"request_hmac" bytea NOT NULL,
	"request_id" text NOT NULL,
	"status" integer NOT NULL,
	"duration_ms" integer NOT NULL,
	"result_count" integer,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "mcp_audit_workspace_created_idx" ON "mcp_audit_log" ("workspace_id","created_at");--> statement-breakpoint
ALTER TABLE "mcp_audit_log" ADD CONSTRAINT "mcp_audit_log_workspace_id_workspaces_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "mcp_audit_log" ADD CONSTRAINT "mcp_audit_log_caller_user_id_users_id_fkey" FOREIGN KEY ("caller_user_id") REFERENCES "users"("id") ON DELETE SET NULL;