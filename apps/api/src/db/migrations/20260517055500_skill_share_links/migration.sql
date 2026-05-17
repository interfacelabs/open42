CREATE TABLE IF NOT EXISTS "skill_share_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "skill_id" uuid NOT NULL REFERENCES "skills"("id") ON DELETE cascade,
  "skill_version_id" uuid NOT NULL REFERENCES "skill_versions"("id") ON DELETE cascade,
  "created_by_user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "token_hash" bytea NOT NULL,
  "storage_key" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_used_at" timestamp with time zone,
  "revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "skill_share_links_token_hash_uniq" ON "skill_share_links" ("token_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "skill_share_links_workspace_created_idx" ON "skill_share_links" ("workspace_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "skill_share_links_expires_idx" ON "skill_share_links" ("expires_at");
