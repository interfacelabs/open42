import { Type, type Static } from '@sinclair/typebox';

export const REQUIRED_SKILL_BODY_HEADINGS = [
  '## Contract',
  '## Phases',
  '## Output Format',
] as const;

/**
 * TypeBox schema for the SKILL.md frontmatter Open42 expects from the
 * Skillify generator.
 *
 * Mirrors gbrain's frontmatter contract minus the gbrain-CLI-only fields
 * (no `tools[]` enforcement, no `writes_to[]` requirement) so the same
 * meta-prompt produces output that validates here without a CLI runtime.
 *
 * The slug pattern matches gbrain's expectation of a kebab-case identifier
 * unique within a workspace. `version` is a strict semver string (skill
 * generation today always emits `0.1.0` — semver bumps come from the
 * revise flow when it lands).
 */
export const SkillFrontmatterSchema = Type.Object(
  {
    name: Type.String({
      pattern: '^[a-z][a-z0-9-]{1,40}[a-z0-9]$',
      description: 'kebab-case slug, 3–42 chars',
    }),
    version: Type.String({
      pattern: '^\\d+\\.\\d+\\.\\d+$',
      description: 'semver MAJOR.MINOR.PATCH',
    }),
    description: Type.String({ minLength: 30, maxLength: 600 }),
    triggers: Type.Array(Type.String({ minLength: 4, maxLength: 80 }), {
      minItems: 1,
      maxItems: 12,
    }),
    tools: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 40 }), {
        maxItems: 8,
      }),
    ),
    mutating: Type.Boolean(),
    writes_pages: Type.Optional(Type.Boolean()),
    writes_to: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 80 }), {
        maxItems: 8,
      }),
    ),
  },
  { additionalProperties: false },
);

export type SkillFrontmatter = Static<typeof SkillFrontmatterSchema>;

/**
 * The SKILL.md body — markdown, no frontmatter delimiters. Length window
 * matches what hotpot enforces for OpenClaw skills (200–20k chars). Below
 * that the body is too thin to be useful; above that the model is almost
 * certainly hallucinating fluff.
 */
export const SkillBodySchema = Type.String({
  minLength: 200,
  maxLength: 20_000,
});

/**
 * Outer envelope returned by the generator and persisted to `skill_versions`.
 * `cited_doc_slugs` is the union of slugs the model said it leaned on —
 * frontend renders them as the `[1] [2] [3]` chips on the brain revision.
 */
export const SkillDraftSchema = Type.Object(
  {
    frontmatter: SkillFrontmatterSchema,
    body: SkillBodySchema,
    cited_doc_slugs: Type.Array(Type.String(), { maxItems: 32 }),
  },
  { additionalProperties: false },
);

export type SkillDraft = Static<typeof SkillDraftSchema>;
