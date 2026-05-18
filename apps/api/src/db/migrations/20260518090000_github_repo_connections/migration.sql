ALTER TYPE "connection_kind" ADD VALUE IF NOT EXISTS 'github-repo';

DO $$ BEGIN
 CREATE TYPE "github_repo_sync_status" AS ENUM (
  'fresh',
  'syncing',
  'behind',
  'stale',
  'errored',
  'auth_required',
  'webhook_unhealthy',
  'degraded'
 );
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 CREATE TYPE "github_repo_sync_transport" AS ENUM (
  'direct-url',
  'open42-git-proxy'
 );
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "github_repo_connections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "connection_id" uuid NOT NULL,
  "installation_id" text NOT NULL,
  "repo_id" text NOT NULL,
  "owner" text NOT NULL,
  "repo" text NOT NULL,
  "branch" text NOT NULL,
  "repo_private" boolean DEFAULT false NOT NULL,
  "gbrain_source_id" text NOT NULL,
  "gbrain_source_registered_at" timestamp with time zone,
  "sync_transport" "github_repo_sync_transport" DEFAULT 'direct-url' NOT NULL,
  "git_proxy_token_hash" text,
  "git_proxy_last_used_at" timestamp with time zone,
  "last_gbrain_job_id" text,
  "path_filters" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "last_indexed_commit_sha" text,
  "branch_head_sha" text,
  "sync_status" "github_repo_sync_status" DEFAULT 'syncing' NOT NULL,
  "last_synced_at" timestamp with time zone,
  "last_error" text,
  "webhook_health" text DEFAULT 'unknown' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "github_repo_connections_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE cascade,
  CONSTRAINT "github_repo_connections_connection_id_connections_id_fk"
    FOREIGN KEY ("connection_id") REFERENCES "connections"("id") ON DELETE cascade
);

CREATE UNIQUE INDEX IF NOT EXISTS "github_repo_connections_connection_uniq"
  ON "github_repo_connections" ("connection_id");

CREATE UNIQUE INDEX IF NOT EXISTS "github_repo_connections_gbrain_source_uniq"
  ON "github_repo_connections" ("workspace_id", "gbrain_source_id");

CREATE UNIQUE INDEX IF NOT EXISTS "github_repo_connections_proxy_token_hash_uniq"
  ON "github_repo_connections" ("git_proxy_token_hash")
  WHERE "git_proxy_token_hash" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "github_repo_connections_workspace_repo_branch_uniq"
  ON "github_repo_connections" ("workspace_id", "repo_id", "branch");

CREATE INDEX IF NOT EXISTS "github_repo_connections_workspace_status_idx"
  ON "github_repo_connections" ("workspace_id", "sync_status");

CREATE INDEX IF NOT EXISTS "github_repo_connections_installation_idx"
  ON "github_repo_connections" ("installation_id");
