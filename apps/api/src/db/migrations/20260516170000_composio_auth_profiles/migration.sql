CREATE TYPE "public"."connector_auth_profile_mode" AS ENUM('open42_managed', 'byok');--> statement-breakpoint

CREATE TABLE "connector_auth_profiles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "provider" text DEFAULT 'composio' NOT NULL,
  "mode" "connector_auth_profile_mode" NOT NULL,
  "label" text NOT NULL,
  "api_key_ciphertext" bytea,
  "base_url" text,
  "created_by_user_id" uuid,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE "connector_auth_profile_services" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "profile_id" uuid NOT NULL,
  "service_id" text NOT NULL,
  "auth_config_id_ciphertext" bytea NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "connections" ADD COLUMN "service_id" text;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "connector_auth_profile_id" uuid;--> statement-breakpoint
ALTER TABLE "connection_init_states" ADD COLUMN "service_id" text;--> statement-breakpoint
ALTER TABLE "connection_init_states" ADD COLUMN "connector_auth_profile_id" uuid;--> statement-breakpoint

UPDATE "connections"
SET "service_id" = 'notion'
WHERE "kind" IN ('notion-composio', 'notion-zip')
  AND "service_id" IS NULL;--> statement-breakpoint

UPDATE "connection_init_states"
SET "service_id" = 'notion'
WHERE "kind" IN ('notion-composio', 'notion-zip')
  AND "service_id" IS NULL;--> statement-breakpoint

ALTER TABLE "connector_auth_profiles" ADD CONSTRAINT "connector_auth_profiles_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_auth_profiles" ADD CONSTRAINT "connector_auth_profiles_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_auth_profile_services" ADD CONSTRAINT "connector_auth_profile_services_profile_id_connector_auth_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."connector_auth_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_connector_auth_profile_id_connector_auth_profiles_id_fk" FOREIGN KEY ("connector_auth_profile_id") REFERENCES "public"."connector_auth_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection_init_states" ADD CONSTRAINT "connection_init_states_connector_auth_profile_id_connector_auth_profiles_id_fk" FOREIGN KEY ("connector_auth_profile_id") REFERENCES "public"."connector_auth_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

CREATE INDEX "connector_auth_profiles_workspace_idx" ON "connector_auth_profiles" ("workspace_id");--> statement-breakpoint
CREATE INDEX "connector_auth_profiles_active_workspace_idx" ON "connector_auth_profiles" ("workspace_id") WHERE "revoked_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "connector_auth_profile_services_uniq" ON "connector_auth_profile_services" ("profile_id","service_id");--> statement-breakpoint
CREATE INDEX "connector_auth_profile_services_service_idx" ON "connector_auth_profile_services" ("service_id");--> statement-breakpoint
CREATE INDEX "connections_connector_auth_profile_idx" ON "connections" ("connector_auth_profile_id") WHERE "connector_auth_profile_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "connections_service_idx" ON "connections" ("service_id") WHERE "service_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "connection_init_states_connector_auth_profile_idx" ON "connection_init_states" ("connector_auth_profile_id") WHERE "connector_auth_profile_id" IS NOT NULL;
