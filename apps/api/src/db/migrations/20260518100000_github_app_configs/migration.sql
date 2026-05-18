CREATE TABLE IF NOT EXISTS "github_app_configs" (
  "workspace_id" uuid PRIMARY KEY NOT NULL,
  "app_id" text NOT NULL,
  "app_slug" text NOT NULL,
  "app_name" text NOT NULL,
  "app_html_url" text,
  "private_key_ciphertext" bytea NOT NULL,
  "webhook_secret_ciphertext" bytea NOT NULL,
  "created_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "github_app_configs_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE cascade,
  CONSTRAINT "github_app_configs_created_by_user_id_users_id_fk"
    FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE set null
);

CREATE INDEX IF NOT EXISTS "github_app_configs_app_id_idx"
  ON "github_app_configs" ("app_id");
