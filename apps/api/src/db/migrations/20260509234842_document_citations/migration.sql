CREATE TABLE "document_citations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"workspace_id" uuid NOT NULL,
	"doc_slug" text NOT NULL,
	"cited_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "skill_exports" ADD COLUMN "cited_doc_slugs" jsonb DEFAULT '[]' NOT NULL;--> statement-breakpoint
CREATE INDEX "document_citations_workspace_slug_idx" ON "document_citations" ("workspace_id","doc_slug");--> statement-breakpoint
CREATE INDEX "document_citations_workspace_cited_at_idx" ON "document_citations" ("workspace_id","cited_at");--> statement-breakpoint
ALTER TABLE "document_citations" ADD CONSTRAINT "document_citations_workspace_id_workspaces_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE;