export type SkillTargetId = 'openclaw' | 'claude-code' | 'hermes';

export interface SkillTarget {
  id: SkillTargetId;
  label: string;
  basePath: string;
  reloadLabel: string;
}

export const DEFAULT_SKILL_TARGET_ID: SkillTargetId = 'openclaw';

export const SKILL_TARGETS: readonly SkillTarget[] = [
  {
    id: 'claude-code',
    label: 'Claude Code',
    basePath: '~/.claude/skills/',
    reloadLabel: 'Claude Code',
  },
  {
    id: 'openclaw',
    label: 'openclaw',
    basePath: '~/.openclaw/skills/',
    reloadLabel: 'openclaw',
  },
  {
    id: 'hermes',
    label: 'hermes',
    basePath: '~/.hermes/skills/',
    reloadLabel: 'hermes',
  },
];

export function skillTargetById(id: string | null): SkillTarget {
  return (
    SKILL_TARGETS.find((target) => target.id === id) ??
    SKILL_TARGETS.find((target) => target.id === DEFAULT_SKILL_TARGET_ID) ??
    SKILL_TARGETS[0]!
  );
}

export function skillInstallDestination(target: SkillTarget, skillName: string): string {
  return `${target.basePath}${skillFolderName(skillName)}/`;
}

export function skillTargetSteps(target: SkillTarget): string[] {
  return [
    `Drop the skill folder into ${target.basePath}.`,
    `Restart ${target.reloadLabel} to reload skills.`,
  ];
}

function skillFolderName(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9_.-]+/g, '-')
      .replace(/^[_.-]+|[_.-]+$/g, '') || 'skill'
  );
}
