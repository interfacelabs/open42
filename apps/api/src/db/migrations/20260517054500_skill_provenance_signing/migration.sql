CREATE TABLE IF NOT EXISTS "workspace_signing_keys" (
  "workspace_id" uuid PRIMARY KEY NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "public_key" text NOT NULL,
  "private_key_ciphertext" bytea NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "skill_citation_provenance" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "skill_version_id" uuid NOT NULL REFERENCES "skill_versions"("id") ON DELETE cascade,
  "citation_index" integer NOT NULL,
  "slug" text NOT NULL,
  "version_id" text,
  "cited_text" text NOT NULL,
  "cited_text_sha256" text NOT NULL,
  "captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "skill_citation_provenance_version_citation_uniq" ON "skill_citation_provenance" ("skill_version_id","citation_index");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "skill_citation_provenance_slug_idx" ON "skill_citation_provenance" ("slug");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "skill_staleness" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "skill_id" uuid NOT NULL REFERENCES "skills"("id") ON DELETE cascade,
  "skill_version_id" uuid NOT NULL REFERENCES "skill_versions"("id") ON DELETE cascade,
  "citation_index" integer NOT NULL,
  "slug" text NOT NULL,
  "previous_version_id" text,
  "latest_version_id" text,
  "previous_cited_text_sha256" text NOT NULL,
  "latest_cited_text_sha256" text NOT NULL,
  "changelog" text,
  "status" text DEFAULT 'stale' NOT NULL,
  "detected_at" timestamp with time zone DEFAULT now() NOT NULL,
  "resolved_at" timestamp with time zone,
  CONSTRAINT "skill_staleness_status_check" CHECK ("status" IN ('stale', 'resolved'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "skill_staleness_version_citation_uniq" ON "skill_staleness" ("skill_version_id","citation_index") WHERE "status" = 'stale';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "skill_staleness_workspace_status_idx" ON "skill_staleness" ("workspace_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "skill_staleness_slug_idx" ON "skill_staleness" ("workspace_id","slug");
--> statement-breakpoint
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
