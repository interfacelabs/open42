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
