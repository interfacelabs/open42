import { describe, expect, it } from 'vitest';

import { SKILLIFY_META_PROMPT, SKILLIFY_SOURCE } from './skillify-meta.js';

/**
 * Smoke tests for the verbatim meta-skill copy. Catches accidental
 * truncation when re-pasting from upstream gbrain.
 */
describe('SKILLIFY_META_PROMPT', () => {
  it('declares its upstream source so future syncs are diff-able', () => {
    expect(SKILLIFY_SOURCE.upstream).toBe('gbrain/skills/skillify/SKILL.md');
    expect(SKILLIFY_SOURCE.license).toBe('MIT');
  });

  it('opens with the YAML frontmatter that defines the skillify skill', () => {
    expect(SKILLIFY_META_PROMPT.startsWith('---\nname: skillify\n')).toBe(true);
    expect(SKILLIFY_META_PROMPT).toMatch(/version: 1\.0\.0/);
    expect(SKILLIFY_META_PROMPT).toMatch(/triggers:/);
    expect(SKILLIFY_META_PROMPT).toMatch(/"skillify this"/);
  });

  it('contains the 10-item Contract and the three Phase headings', () => {
    expect(SKILLIFY_META_PROMPT).toContain('# Skillify — The Meta Skill');
    expect(SKILLIFY_META_PROMPT).toContain('## Contract');
    expect(SKILLIFY_META_PROMPT).toContain('### Phase 1: Audit what exists');
    expect(SKILLIFY_META_PROMPT).toContain(
      '### Phase 2: Create missing pieces in order',
    );
    expect(SKILLIFY_META_PROMPT).toContain('### Phase 3: Verify');
  });

  it('preserves the gbrain CLI references verbatim (Open42 strips them at the validator, not the prompt)', () => {
    expect(SKILLIFY_META_PROMPT).toContain('gbrain skillify scaffold');
    expect(SKILLIFY_META_PROMPT).toContain('gbrain check-resolvable');
    expect(SKILLIFY_META_PROMPT).toContain('SKILLIFY_STUB');
  });
});
