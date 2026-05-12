CREATE TABLE IF NOT EXISTS "workspace_billing" (
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
    FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action
);--> statement-breakpoint
INSERT INTO "workspace_billing" (
  "workspace_id",
  "plan_key",
  "mode",
  "stripe_customer_id",
  "stripe_subscription_id",
  "stripe_subscription_status",
  "stripe_subscription_current_period_start",
  "stripe_subscription_current_period_end"
)
SELECT
  "id",
  "billing_plan_key",
  "billing_mode",
  "stripe_customer_id",
  "stripe_subscription_id",
  "stripe_subscription_status",
  "stripe_subscription_current_period_start",
  "stripe_subscription_current_period_end"
FROM "workspaces"
WHERE "stripe_customer_id" IS NOT NULL
  OR "stripe_subscription_id" IS NOT NULL
ON CONFLICT ("workspace_id") DO UPDATE SET
  "plan_key" = EXCLUDED."plan_key",
  "mode" = EXCLUDED."mode",
  "stripe_customer_id" = EXCLUDED."stripe_customer_id",
  "stripe_subscription_id" = EXCLUDED."stripe_subscription_id",
  "stripe_subscription_status" = EXCLUDED."stripe_subscription_status",
  "stripe_subscription_current_period_start" = EXCLUDED."stripe_subscription_current_period_start",
  "stripe_subscription_current_period_end" = EXCLUDED."stripe_subscription_current_period_end",
  "updated_at" = now();--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workspace_billing_stripe_customer_id_uniq"
  ON "workspace_billing" ("stripe_customer_id")
  WHERE "stripe_customer_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workspace_billing_stripe_subscription_id_uniq"
  ON "workspace_billing" ("stripe_subscription_id")
  WHERE "stripe_subscription_id" IS NOT NULL;
