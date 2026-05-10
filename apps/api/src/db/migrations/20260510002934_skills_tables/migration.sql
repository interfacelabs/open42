CREATE TYPE "skill_revision_role" AS ENUM('you', 'brain');--> statement-breakpoint
CREATE TABLE "skill_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"skill_id" uuid NOT NULL,
	"version_id" uuid,
	"role" "skill_revision_role" NOT NULL,
	"text" text NOT NULL,
	"cites" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skill_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"skill_id" uuid NOT NULL,
	"version" text NOT NULL,
	"frontmatter" jsonb NOT NULL,
	"body" text NOT NULL,
	"cited_doc_slugs" jsonb DEFAULT '[]' NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "skill_revisions_skill_created_idx" ON "skill_revisions" ("skill_id","created_at");--> statement-breakpoint
CREATE INDEX "skill_versions_skill_created_idx" ON "skill_versions" ("skill_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "skill_versions_skill_version_uniq" ON "skill_versions" ("skill_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "skills_workspace_name_uniq" ON "skills" ("workspace_id","name");--> statement-breakpoint
ALTER TABLE "skill_revisions" ADD CONSTRAINT "skill_revisions_skill_id_skills_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "skills"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "skill_revisions" ADD CONSTRAINT "skill_revisions_version_id_skill_versions_id_fkey" FOREIGN KEY ("version_id") REFERENCES "skill_versions"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "skill_versions" ADD CONSTRAINT "skill_versions_skill_id_skills_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "skills"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "skill_versions" ADD CONSTRAINT "skill_versions_created_by_user_id_users_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_workspace_id_workspaces_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE;