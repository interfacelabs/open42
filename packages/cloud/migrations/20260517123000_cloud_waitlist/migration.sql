CREATE TABLE "cloud_waitlist_entries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "email" text NOT NULL,
  "source" text DEFAULT 'landing' NOT NULL,
  "user_agent" text,
  "ip" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX "cloud_waitlist_entries_email_uniq"
  ON "cloud_waitlist_entries" ("email");--> statement-breakpoint
CREATE INDEX "cloud_waitlist_entries_created_at_idx"
  ON "cloud_waitlist_entries" ("created_at");
