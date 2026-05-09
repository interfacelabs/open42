ALTER TABLE "workspaces" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "provision_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "provisioning_started_at" timestamp with time zone DEFAULT now() NOT NULL;
