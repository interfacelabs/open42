import AdmZip from 'adm-zip';
import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

import type { GbrainCitationChunk, GbrainClient } from '../../gbrain/client.js';
import { citationsFromChunks, type SkillCitation } from '../citations.js';
import { summarizeFreshness, type FreshnessSummary } from '../freshness.js';

const FrontmatterSchema = Type.Object({
  name: Type.Literal('refund-policy'),
  description: Type.String(),
  source_brain: Type.String(),
  generated_at: Type.String(),
  gbrain_version: Type.String(),
  open42_version: Type.String(),
  citations: Type.Array(
    Type.Object({
      slug: Type.String(),
      version_id: Type.Number(),
      last_updated: Type.String(),
      excerpt: Type.String(),
    }),
  ),
  freshness: Type.Object({
    oldest_source_at: Type.Union([Type.String(), Type.Null()]),
    newest_source_at: Type.Union([Type.String(), Type.Null()]),
    staleness_warning: Type.Boolean(),
  }),
});

export interface RefundPolicySkillBundle {
  zip: Buffer;
  skillMarkdown: string;
  frontmatter: {
    name: 'refund-policy';
    description: string;
    source_brain: string;
    generated_at: string;
    gbrain_version: string;
    open42_version: string;
    citations: SkillCitation[];
    freshness: FreshnessSummary;
  };
  manifest: Record<string, unknown>;
}

export async function generateRefundPolicySkill(options: {
  gbrain: Pick<GbrainClient, 'query' | 'getChunks'>;
  workspaceId: string;
  gbrainVersion: string;
  open42Version?: string;
  now?: Date;
  anthropicGenerate?: (prompt: string) => Promise<string>;
}): Promise<RefundPolicySkillBundle> {
  const now = options.now ?? new Date();
  const query = await options.gbrain.query({
    query: 'refund policy refunds enterprise SLA cancellation return payment processor',
    limit: 20,
    detail: 'chunks',
  });
  const chunks = rerankRefundChunks(query.chunks ?? query.results ?? [], now).slice(0, 20);
  const citations = await citationsFromChunks(options.gbrain, chunks);
  const freshness = summarizeFreshness(citations, now);
  const prompt = buildPrompt(chunks, citations);
  const skillMarkdown =
    (await options.anthropicGenerate?.(prompt)) ?? fallbackSkillMarkdown(chunks, citations);

  const frontmatter = {
    name: 'refund-policy' as const,
    description: `How this company handles refund requests, generated from Notion as of ${now.toISOString().slice(0, 10)}`,
    source_brain: options.workspaceId,
    generated_at: now.toISOString(),
    gbrain_version: options.gbrainVersion,
    open42_version: options.open42Version ?? '0.1.0',
    citations,
    freshness,
  };
  if (!Value.Check(FrontmatterSchema, frontmatter)) {
    throw new Error('refund_policy_frontmatter_invalid');
  }

  const manifest = {
    name: 'refund-policy',
    version: '0.1.0',
    entrypoint: 'SKILL.md',
    generated_at: frontmatter.generated_at,
  };
  const zip = new AdmZip();
  zip.addFile('refund-policy/SKILL.md', Buffer.from(skillMarkdown, 'utf8'));
  zip.addFile('refund-policy/frontmatter.yaml', Buffer.from(formatYaml(frontmatter), 'utf8'));
  zip.addFile('refund-policy/manifest.json', Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'));

  return {
    zip: zip.toBuffer(),
    skillMarkdown,
    frontmatter,
    manifest,
  };
}

function rerankRefundChunks(chunks: GbrainCitationChunk[], now: Date): GbrainCitationChunk[] {
  return [...chunks].sort((a, b) => scoreChunk(b, now) - scoreChunk(a, now));
}

function scoreChunk(chunk: GbrainCitationChunk, now: Date): number {
  const text = `${chunk.slug ?? ''} ${chunk.excerpt ?? chunk.chunk_text ?? ''}`.toLowerCase();
  const relevance = ['refund', 'return', 'enterprise', 'sla', 'payment'].reduce(
    (score, term) => score + (text.includes(term) ? 1 : 0),
    0,
  );
  const updated = chunk.last_updated ? new Date(chunk.last_updated).getTime() : 0;
  const recency = updated > 0 ? Math.max(0, 1 - (now.getTime() - updated) / (365 * 24 * 60 * 60 * 1000)) : 0;
  return relevance * 10 + recency + Number(chunk.score ?? 0);
}

function buildPrompt(chunks: GbrainCitationChunk[], citations: SkillCitation[]): string {
  return [
    'Generate a concise SKILL.md for a coding/support agent that must answer refund questions with citations.',
    'Use only the cited chunks. Include bracket citations like [refund-policy-2024 v7].',
    '',
    ...chunks.map((chunk, index) => {
      const citation = citations.find((item) => item.slug === chunk.slug);
      return `Source ${index + 1}: ${citation?.slug ?? chunk.slug ?? 'unknown'} v${citation?.version_id ?? chunk.version_id ?? 0}\n${chunk.excerpt ?? chunk.chunk_text ?? ''}`;
    }),
  ].join('\n');
}

function fallbackSkillMarkdown(chunks: GbrainCitationChunk[], citations: SkillCitation[]): string {
  if (chunks.length === 0) {
    return [
      '# Refund Policy',
      '',
      "The brain does not currently contain enough cited refund-policy material to generate an operational policy.",
    ].join('\n');
  }
  return [
    '# Refund Policy',
    '',
    'Use this skill when answering refund, return, cancellation, or enterprise SLA refund questions.',
    '',
    '## Source-Grounded Guidance',
    ...citations.slice(0, 8).map((citation) => {
      const excerpt = citation.excerpt.replace(/\s+/g, ' ').trim();
      return `- ${excerpt} [${citation.slug} v${citation.version_id}]`;
    }),
    '',
    'If a question is not covered by these citations, say that the brain does not have enough information.',
  ].join('\n');
}

function formatYaml(value: RefundPolicySkillBundle['frontmatter']): string {
  return [
    `name: ${value.name}`,
    `description: ${quote(value.description)}`,
    `source_brain: ${value.source_brain}`,
    `generated_at: ${value.generated_at}`,
    `gbrain_version: ${value.gbrain_version}`,
    `open42_version: ${value.open42_version}`,
    'citations:',
    ...value.citations.flatMap((citation) => [
      `  - slug: ${citation.slug}`,
      `    version_id: ${citation.version_id}`,
      `    last_updated: ${citation.last_updated}`,
      `    excerpt: ${quote(citation.excerpt)}`,
    ]),
    'freshness:',
    `  oldest_source_at: ${value.freshness.oldest_source_at ?? 'null'}`,
    `  newest_source_at: ${value.freshness.newest_source_at ?? 'null'}`,
    `  staleness_warning: ${value.freshness.staleness_warning}`,
    '',
  ].join('\n');
}

function quote(value: string): string {
  return JSON.stringify(value);
}
