import type { GbrainCitationChunk, GbrainClient } from '../gbrain/client.js';

export interface SkillCitation {
  slug: string;
  version_id: number;
  last_updated: string;
  excerpt: string;
}

export async function citationsFromChunks(
  gbrain: Pick<GbrainClient, 'getChunks'>,
  chunks: GbrainCitationChunk[],
): Promise<SkillCitation[]> {
  const bySlug = new Map<string, GbrainCitationChunk>();
  for (const chunk of chunks) {
    if (chunk.slug && !bySlug.has(chunk.slug)) bySlug.set(chunk.slug, chunk);
  }

  const citations: SkillCitation[] = [];
  for (const [slug, chunk] of bySlug) {
    const sourceChunks = await gbrain.getChunks(slug);
    const authoritative = sourceChunks.find((item) => item.version_id || item.last_updated) ?? chunk;
    citations.push({
      slug,
      version_id: Number(authoritative.version_id ?? chunk.version_id ?? 0),
      last_updated: String(authoritative.last_updated ?? chunk.last_updated ?? new Date(0).toISOString()),
      excerpt: String(authoritative.excerpt ?? authoritative.chunk_text ?? chunk.excerpt ?? chunk.chunk_text ?? ''),
    });
  }

  return citations;
}
