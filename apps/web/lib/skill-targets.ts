export type SkillTargetId = 'openclaw' | 'claude-code' | 'hermes';

export interface SkillTarget {
  id: SkillTargetId;
  label: string;
  installPath: string;
  steps: string[];
}

export const SKILL_TARGETS: readonly SkillTarget[] = [
  {
    id: 'openclaw',
    label: 'openclaw',
    installPath: '~/.openclaw/skills/',
    steps: [
      'Move the exported folder into ~/.openclaw/skills/.',
      'Restart openclaw so it reloads local skills.',
      'Ask openclaw to use this skill by name.',
    ],
  },
  {
    id: 'claude-code',
    label: 'Claude Code',
    installPath: '~/.claude/skills/',
    steps: [
      'Unzip the bundle into ~/.claude/skills/.',
      'Restart Claude Code in the project where you need it.',
      'Reference the skill name when asking for the workflow.',
    ],
  },
  {
    id: 'hermes',
    label: 'hermes',
    installPath: '~/.hermes/skills/',
    steps: [
      'Unzip the bundle into ~/.hermes/skills/.',
      'Restart hermes to refresh its skill registry.',
      'Run the matching workflow from the hermes skill picker.',
    ],
  },
];

export function skillTargetById(id: string | null): SkillTarget {
  return SKILL_TARGETS.find((target) => target.id === id) ?? SKILL_TARGETS[0]!;
}
