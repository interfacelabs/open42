DROP INDEX IF EXISTS "workspaces_stripe_customer_id_uniq";--> statement-breakpoint
DROP INDEX IF EXISTS "workspaces_stripe_subscription_id_uniq";--> statement-breakpoint
ALTER TABLE "workspaces"
  DROP COLUMN IF EXISTS "billing_plan_key",
  DROP COLUMN IF EXISTS "billing_mode",
  DROP COLUMN IF EXISTS "stripe_customer_id",
  DROP COLUMN IF EXISTS "stripe_subscription_id",
  DROP COLUMN IF EXISTS "stripe_subscription_status",
  DROP COLUMN IF EXISTS "stripe_subscription_current_period_start",
  DROP COLUMN IF EXISTS "stripe_subscription_current_period_end";
