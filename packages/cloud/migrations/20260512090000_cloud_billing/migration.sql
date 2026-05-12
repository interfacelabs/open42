CREATE TYPE "workspace_billing_mode" AS ENUM ('platform', 'byok');--> statement-breakpoint
CREATE TYPE "billing_usage_status" AS ENUM ('included', 'metered', 'unreported', 'failed', 'ignored');--> statement-breakpoint
CREATE TABLE "workspace_billing" (
  "workspace_id" uuid PRIMARY KEY NOT NULL,
  "plan_key" text DEFAULT 'basic' NOT NULL,
  "mode" "workspace_billing_mode" DEFAULT 'platform' NOT NULL,
  "stripe_customer_id" text,
  "stripe_subscription_id" text,
  "stripe_subscription_status" text,
  "stripe_subscription_current_period_start" timestamp with time zone,
  "stripe_subscription_current_period_end" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "workspace_billing_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE cascade
);--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_billing_stripe_customer_id_uniq"
  ON "workspace_billing" ("stripe_customer_id")
  WHERE "stripe_customer_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_billing_stripe_subscription_id_uniq"
  ON "workspace_billing" ("stripe_subscription_id")
  WHERE "stripe_subscription_id" IS NOT NULL;--> statement-breakpoint
CREATE TABLE "billing_usage_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "provider" "llm_provider" NOT NULL,
  "scope" "llm_scope" NOT NULL,
  "key_source" text NOT NULL,
  "units" integer DEFAULT 1 NOT NULL,
  "included_units" integer DEFAULT 0 NOT NULL,
  "billable_units" integer DEFAULT 0 NOT NULL,
  "status" "billing_usage_status" NOT NULL,
  "stripe_customer_id" text,
  "stripe_meter_event_name" text,
  "stripe_meter_event_identifier" text,
  "error" text,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "billing_usage_events_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE cascade,
  CONSTRAINT "billing_usage_events_units_positive" CHECK ("units" > 0),
  CONSTRAINT "billing_usage_events_included_units_nonnegative" CHECK ("included_units" >= 0),
  CONSTRAINT "billing_usage_events_billable_units_nonnegative" CHECK ("billable_units" >= 0),
  CONSTRAINT "billing_usage_events_key_source_check" CHECK ("key_source" IN ('tenant', 'shared'))
);--> statement-breakpoint
CREATE INDEX "billing_usage_events_workspace_occurred_idx"
  ON "billing_usage_events" ("workspace_id", "occurred_at");--> statement-breakpoint
CREATE INDEX "billing_usage_events_workspace_status_idx"
  ON "billing_usage_events" ("workspace_id", "status");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_usage_events_stripe_meter_identifier_uniq"
  ON "billing_usage_events" ("stripe_meter_event_identifier")
  WHERE "stripe_meter_event_identifier" IS NOT NULL;--> statement-breakpoint
CREATE TABLE "stripe_webhook_events" (
  "id" text PRIMARY KEY NOT NULL,
  "type" text NOT NULL,
  "processing_started_at" timestamp with time zone,
  "processed_at" timestamp with time zone,
  "error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "stripe_webhook_events_processed_at_idx"
  ON "stripe_webhook_events" ("processed_at");
