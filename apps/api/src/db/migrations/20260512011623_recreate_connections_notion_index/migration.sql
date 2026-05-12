-- Recreate connections_one_notion_per_workspace with the IMMUTABLE-safe
-- predicate. The historical migration 20260506183223_left_lady_vermin was
-- patched in-place during pre-flight (commit 8cf7b46) to switch the
-- predicate from "kind"::text LIKE 'notion-%' (which is not IMMUTABLE and
-- failed at apply time on some Postgres versions) to the IN-clause form.
-- That edit keeps fresh installs working but leaves existing databases in
-- ambiguous states:
--   - Databases that ran the original broken predicate failed migration —
--     they don't exist in the wild.
--   - Databases that have the LATER migration 20260507133200_talented_kylun
--     applied already converged on the IN-clause form via that migration.
--   - Databases that synthesized the schema via db:push hold whatever
--     drizzle-kit emitted at the time.
-- This migration drops + recreates the index so every environment converges
-- on the same definition, regardless of prior state. It's idempotent on
-- databases that already match.
DROP INDEX IF EXISTS "connections_one_notion_per_workspace";--> statement-breakpoint
CREATE UNIQUE INDEX "connections_one_notion_per_workspace"
  ON "connections" ("workspace_id")
  WHERE "kind" IN ('notion-composio', 'notion-zip')
  AND "status" <> 'disconnected';
