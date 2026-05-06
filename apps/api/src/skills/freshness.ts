import type { SkillCitation } from './citations.js';

export interface FreshnessSummary {
  oldest_source_at: string | null;
  newest_source_at: string | null;
  staleness_warning: boolean;
}

const STALE_MS = 90 * 24 * 60 * 60 * 1000;

export function summarizeFreshness(
  citations: Pick<SkillCitation, 'last_updated'>[],
  now = new Date(),
): FreshnessSummary {
  const timestamps = citations
    .map((citation) => new Date(citation.last_updated))
    .filter((date) => Number.isFinite(date.getTime()))
    .sort((a, b) => a.getTime() - b.getTime());
  const oldest = timestamps[0] ?? null;
  const newest = timestamps.at(-1) ?? null;

  return {
    oldest_source_at: oldest?.toISOString() ?? null,
    newest_source_at: newest?.toISOString() ?? null,
    staleness_warning: timestamps.some((date) => now.getTime() - date.getTime() > STALE_MS),
  };
}
