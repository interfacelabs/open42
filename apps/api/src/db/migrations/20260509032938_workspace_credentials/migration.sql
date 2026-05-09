CREATE TYPE "llm_provider" AS ENUM('openai', 'anthropic');--> statement-breakpoint
CREATE TYPE "llm_scope" AS ENUM('chat', 'embed');--> statement-breakpoint
CREATE TABLE "workspace_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"workspace_id" uuid NOT NULL,
	"provider" "llm_provider" NOT NULL,
	"scope" "llm_scope" NOT NULL,
	"secret_ciphertext" bytea NOT NULL,
	"model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_credentials_uniq" ON "workspace_credentials" ("workspace_id","provider","scope");--> statement-breakpoint
ALTER TABLE "workspace_credentials" ADD CONSTRAINT "workspace_credentials_workspace_id_workspaces_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE;