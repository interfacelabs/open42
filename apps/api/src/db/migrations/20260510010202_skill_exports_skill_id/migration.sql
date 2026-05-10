ALTER TABLE "skill_exports" ADD COLUMN "skill_id" uuid;--> statement-breakpoint
ALTER TABLE "skill_exports" ALTER COLUMN "skill_type" DROP NOT NULL;--> statement-breakpoint
CREATE INDEX "skill_exports_skill_idx" ON "skill_exports" ("skill_id");--> statement-breakpoint
ALTER TABLE "skill_exports" ADD CONSTRAINT "skill_exports_skill_id_skills_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "skills"("id") ON DELETE SET NULL;