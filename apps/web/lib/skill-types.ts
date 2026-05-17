/**
 * Shape of a draftable skill bundle as surfaced in the SkillPanel.
 *
 * Served by the proxy at /pages/api/workspaces/[id]/skills/[skillId]/draft,
 * which forwards to apps/api `/workspaces/:id/skills/:skillId/draft`
 * (workspace-scoped; membership enforced via requireMembership).
 */

export type SkillRevisionRole = 'you' | 'brain';

export interface SkillRevision {
  id: string;
  role: SkillRevisionRole;
  text: string;
  /** Sources cited by this revision turn (e.g., "[1]", "[2] [3]"). */
  cites?: string;
}

export interface SkillCite {
  index: number;
  slug: string;
  lastUpdated?: string;
}

export interface SkillDraft {
  id: string;
  name: string;
  version: string;
  /** Markdown body — used by the panel preview and the export bundle. */
  body: string;
  explainer?: string | null;
  cites: SkillCite[];
  revisions: SkillRevision[];
  /** True if there are unsaved revisions ahead of `version`. */
  unsaved?: boolean;
  staleness?: {
    changelog: string;
    detectedAt: string;
  } | null;
}
