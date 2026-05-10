/**
 * Shape of a draftable skill bundle as surfaced in the SkillPanel.
 *
 * Today this is served by the web-side stub at /pages/api/skills/[id]/draft —
 * the real implementation will come from apps/api once skill drafting moves
 * server-side (P6c).
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
  cites: SkillCite[];
  revisions: SkillRevision[];
  /** True if there are unsaved revisions ahead of `version`. */
  unsaved?: boolean;
}
