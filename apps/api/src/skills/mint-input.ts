const MAX_INTENT_CHARS = 2_000;
const MAX_CITATIONS = 32;

export interface MintThreadCitationInput {
  slug: string;
  lastUpdated?: string;
}

export interface MintInput {
  intent: string;
  threadCitations: MintThreadCitationInput[];
}

export type ParseResult = ({ ok: true } & MintInput) | { ok: false; error: string };

/**
 * Pure validator for `POST /skills` request bodies. Lives in `skills/`
 * (not `routes/skills/`) so tests can import it without dragging the db
 * client into module load.
 */
export function parseMintInput(raw: unknown): ParseResult {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'body_required' };
  }
  const body = raw as Record<string, unknown>;
  const intent = typeof body.intent === 'string' ? body.intent.trim() : '';
  if (!intent) return { ok: false, error: 'intent_required' };
  if (intent.length > MAX_INTENT_CHARS) {
    return { ok: false, error: 'intent_too_long' };
  }

  const threadCitations: MintThreadCitationInput[] = [];
  if (Array.isArray(body.threadCitations)) {
    if (body.threadCitations.length > MAX_CITATIONS) {
      return { ok: false, error: 'too_many_citations' };
    }
    for (const item of body.threadCitations) {
      if (!item || typeof item !== 'object') {
        return { ok: false, error: 'citation_invalid' };
      }
      const c = item as Record<string, unknown>;
      const slug = typeof c.slug === 'string' ? c.slug.trim() : '';
      if (!slug) return { ok: false, error: 'citation_slug_required' };
      const lastUpdated = typeof c.lastUpdated === 'string' ? c.lastUpdated.trim() : '';
      threadCitations.push({
        slug,
        lastUpdated: lastUpdated || undefined,
      });
    }
  }

  return { ok: true, intent, threadCitations };
}

export function estimateInputChars(input: MintInput): number {
  return (
    input.intent.length +
    input.threadCitations.reduce(
      (sum, c) => sum + c.slug.length + (c.lastUpdated?.length ?? 0) + 16,
      0,
    )
  );
}
