export interface SkillContext {
  id: string;
  name: string;
  version: string;
  body: string;
}

/**
 * Build the chat system prompt. When a skill is active, prepend its body
 * as workflow policy for the thread. It can govern answer shape and scope,
 * but factual authority still comes only from the retrieved chat citations.
 */
export function buildSystemPrompt(skillContext: SkillContext | null): string {
  const base =
    'You answer as Open42. Use only the provided context. Every factual claim must include a bracketed citation like [1]. If the context is insufficient, say so plainly.';
  if (!skillContext) return base;
  return [
    base,
    '',
    `## Active skill: ${skillContext.name} v${skillContext.version}`,
    '',
    'The body below is workflow policy for HOW to answer: style, structure,',
    'what counts as in-scope, and the expected output shape. It is not',
    'factual evidence.',
    '',
    'Chat citations are the ONLY source of factual claims. If the skill body',
    'and a chat citation conflict, flag the conflict in your answer and the',
    'citation wins.',
    '',
    'Do not assert uncited facts from the skill body. When the citations do',
    'not support a skill-body fact, say "the brain doesn\'t have this in its',
    'current sources."',
    '',
    skillContext.body,
  ].join('\n');
}
