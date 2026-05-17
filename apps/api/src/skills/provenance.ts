import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';

import { db as defaultDb, schema } from '../db/client.js';
import type { GbrainCitationChunk, GbrainClient } from '../gbrain/client.js';

export const MAX_PROVENANCE_EXCERPT_CHARS = 6_000;

export interface CaptureSkillProvenanceInput {
  skillVersionId: string;
  citedDocSlugs: string[];
  gbrain: Pick<GbrainClient, 'getChunks'>;
}

export interface CaptureSkillProvenanceDeps {
  db?: typeof defaultDb;
}

export async function captureSkillCitationProvenance(
  input: CaptureSkillProvenanceInput,
  deps: CaptureSkillProvenanceDeps = {},
): Promise<void> {
  const db = deps.db ?? defaultDb;
  const citedDocSlugs = Array.from(new Set(input.citedDocSlugs.filter(Boolean)));
  if (citedDocSlugs.length === 0) return;
  const [existing] = await db
    .select({ id: schema.skillCitationProvenance.skillVersionId })
    .from(schema.skillCitationProvenance)
    .where(eq(schema.skillCitationProvenance.skillVersionId, input.skillVersionId))
    .limit(1);
  if (existing) return;

  const rows = [];
  for (const [index, slug] of citedDocSlugs.entries()) {
    const chunks = await input.gbrain.getChunks(slug);
    const citedText = citedTextFromChunks(chunks);
    if (!citedText) continue;
    rows.push({
      skillVersionId: input.skillVersionId,
      citationIndex: index + 1,
      slug,
      versionId: latestVersionIdFromChunks(chunks),
      citedText,
      citedTextSha256: sha256Hex(citedText),
    });
  }

  if (rows.length === 0) return;
  await db
    .delete(schema.skillCitationProvenance)
    .where(eq(schema.skillCitationProvenance.skillVersionId, input.skillVersionId));
  await db.insert(schema.skillCitationProvenance).values(rows);
}

export function citedTextSha256(citedText: string): string {
  return sha256Hex(citedText);
}

export function citedTextFromChunks(chunks: GbrainCitationChunk[]): string {
  return chunks
    .map((chunk) => chunk.chunk_text ?? chunk.excerpt ?? '')
    .filter((text) => text.trim().length > 0)
    .join('\n\n')
    .trim()
    .slice(0, MAX_PROVENANCE_EXCERPT_CHARS);
}

export function latestVersionIdFromChunks(chunks: GbrainCitationChunk[]): string | null {
  const versions = chunks
    .map((chunk) => chunk.version_id)
    .filter((value): value is number => typeof value === 'number')
    .sort((a, b) => a - b);
  return versions.at(-1)?.toString() ?? null;
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
