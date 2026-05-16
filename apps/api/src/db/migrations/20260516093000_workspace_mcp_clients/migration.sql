CREATE TABLE "workspace_mcp_clients" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "created_by_user_id" uuid,
  "label" text NOT NULL,
  "client_id_hash" bytea NOT NULL,
  "scopes" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_used_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  CONSTRAINT "workspace_mcp_clients_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE cascade,
  CONSTRAINT "workspace_mcp_clients_created_by_user_id_users_id_fk"
    FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE set null
);--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_mcp_clients_workspace_hash_uniq"
  ON "workspace_mcp_clients" ("workspace_id", "client_id_hash");--> statement-breakpoint
CREATE INDEX "workspace_mcp_clients_workspace_created_idx"
  ON "workspace_mcp_clients" ("workspace_id", "created_at");--> statement-breakpoint
CREATE TABLE "workspace_mcp_access_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "client_id" uuid NOT NULL,
  "token_hash" bytea NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_used_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  CONSTRAINT "workspace_mcp_access_tokens_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE cascade,
  CONSTRAINT "workspace_mcp_access_tokens_client_id_workspace_mcp_clients_id_fk"
    FOREIGN KEY ("client_id") REFERENCES "workspace_mcp_clients"("id") ON DELETE cascade
);--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_mcp_access_tokens_hash_uniq"
  ON "workspace_mcp_access_tokens" ("token_hash");--> statement-breakpoint
CREATE INDEX "workspace_mcp_access_tokens_workspace_expires_idx"
  ON "workspace_mcp_access_tokens" ("workspace_id", "expires_at");
