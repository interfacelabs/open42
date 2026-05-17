/**
 * Public shape returned by the skill draft endpoints (`GET /skills/:id/draft`
 * and `POST /skills`/`POST /skills/:id/revise`). Mirrors
 * `apps/web/lib/skill-types.ts:SkillDraft` 1:1 — the web proxy passes this
 * straight through.
 *
 * Lives in `skills/` (not `routes/skills/`) so non-route consumers can
 * import the type without dragging in HTTP plumbing.
 */
export interface SkillDraftResponse {
  id: string;
  name: string;
  version: string;
  body: string;
  cites: Array<{ index: number; slug: string; lastUpdated?: string }>;
  revisions: Array<{
    id: string;
    role: 'you' | 'brain';
    text: string;
    cites?: string;
  }>;
  staleness?: {
    changelog: string;
    detectedAt: string;
  } | null;
}
