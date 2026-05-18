/**
 * Pure logic for the Library surface.
 *
 * Normalizes whatever gbrain `list_pages` actually returns (the gbrain client
 * types it as `unknown`) into the LibraryDoc shape the web app expects, and
 * applies the smart-collection filters that don't yet require new Open42 tables.
 *
 * Most-cited and cited-in-skills are deliberately not implemented here — those
 * collections need schema additions (P4c-B). Routes that ask for them get an
 * empty list and the UI shows the honest empty state.
 */

export interface LibraryDocShape {
  id: string;
  title: string;
  source: string;
  sourceUrl?: string;
  author?: string;
  lastModifiedAt: string;
  tags: string[];
  citationCount: number;
  snippet?: string;
  body?: string;
}

/** Conservative shape we can extract from a gbrain page object. */
interface GbrainPage {
  slug?: unknown;
  title?: unknown;
  type?: unknown;
  tag?: unknown;
  tags?: unknown;
  last_updated?: unknown;
  source_url?: unknown;
  source_id?: unknown;
  author?: unknown;
}

/**
 * Normalize whatever shape `gbrain.listPages()` returns into a list of pages.
 * Accepts: `[…]`, `{ pages: [...] }`, `{ results: [...] }`. Anything else → [].
 */
export function normalizeListPages(raw: unknown): GbrainPage[] {
  if (Array.isArray(raw)) return raw as GbrainPage[];
  if (raw && typeof raw === 'object') {
    const obj = raw as { pages?: unknown; results?: unknown };
    if (Array.isArray(obj.pages)) return obj.pages as GbrainPage[];
    if (Array.isArray(obj.results)) return obj.results as GbrainPage[];
  }
  return [];
}

export function pageToDoc(page: GbrainPage): LibraryDocShape | null {
  const slug = typeof page.slug === 'string' ? page.slug : null;
  if (!slug) return null;

  const lastModifiedAt =
    typeof page.last_updated === 'string'
      ? page.last_updated
      : new Date(0).toISOString();

  // Tags: accept string[] or single string (`tag` field) or absent.
  const tags = extractTags(page);

  return {
    id: slug,
    title: typeof page.title === 'string' ? page.title : slug,
    source: typeof page.source_id === 'string' && page.source_id.startsWith('gh-')
      ? 'github'
      : 'notion',
    sourceUrl: typeof page.source_url === 'string' ? page.source_url : undefined,
    author: typeof page.author === 'string' ? page.author : undefined,
    lastModifiedAt,
    tags,
    // No citation tracking until P4c-B (document_citations table).
    citationCount: 0,
  };
}

function extractTags(page: GbrainPage): string[] {
  if (Array.isArray(page.tags)) {
    return page.tags.filter((t): t is string => typeof t === 'string');
  }
  if (typeof page.tag === 'string') return [page.tag];
  return [];
}

export interface AssembleParams {
  collection?: string;
  source?: string;
  /** Reference time for the stale-window filter. Defaults to `Date.now()`. */
  now?: Date;
  /**
   * Slugs that have been cited by at least one exported skill bundle. Used by
   * the `cited-in-skills` collection. Pass an empty Set if you don't have one.
   */
  citedInSkills?: ReadonlySet<string>;
}

/**
 * Enrich a doc list with `citationCount` from a slug → count lookup. Docs
 * without an entry in the map keep `citationCount: 0`.
 */
export function enrichWithCitationCounts(
  docs: LibraryDocShape[],
  counts: ReadonlyMap<string, number>,
): LibraryDocShape[] {
  if (counts.size === 0) return docs;
  return docs.map((doc) => ({
    ...doc,
    citationCount: counts.get(doc.id) ?? doc.citationCount,
  }));
}

/**
 * Apply Open42-side smart-collection filtering to a normalized doc list.
 * Most-cited and cited-in-skills now use real Open42 data; the caller is
 * responsible for setting `citationCount` on the docs (via
 * `enrichWithCitationCounts`) and passing `citedInSkills`.
 */
export function assembleLibrary(
  docs: LibraryDocShape[],
  params: AssembleParams,
): LibraryDocShape[] {
  const { collection, source } = params;
  const now = params.now ?? new Date();

  // Source filter is applied first — narrow the universe before sorting.
  const filtered =
    source && source.length > 0 ? docs.filter((d) => d.source === source) : docs;

  switch (collection) {
    case 'recently-changed':
      return [...filtered].sort(
        (a, b) =>
          new Date(b.lastModifiedAt).getTime() -
          new Date(a.lastModifiedAt).getTime(),
      );
    case 'stale':
      return filtered.filter((d) => {
        const age =
          (now.getTime() - new Date(d.lastModifiedAt).getTime()) / 86_400_000;
        return age > 90;
      });
    case 'untagged':
      return filtered.filter((d) => d.tags.length === 0);
    case 'most-cited':
      return [...filtered]
        .filter((d) => d.citationCount > 0)
        .sort((a, b) => b.citationCount - a.citationCount);
    case 'cited-in-skills': {
      const set = params.citedInSkills;
      if (!set || set.size === 0) return [];
      return filtered.filter((d) => set.has(d.id));
    }
    default:
      return filtered;
  }
}

/**
 * Assemble the doc-detail body from gbrain `getChunks(slug)`. Concatenates
 * chunk text in order; returns empty body if gbrain has nothing.
 */
export interface DocChunk {
  slug?: unknown;
  version_id?: unknown;
  last_updated?: unknown;
  excerpt?: unknown;
  chunk_text?: unknown;
}

export interface DocDetailShape extends LibraryDocShape {
  body: string;
  snippet: string;
}

export function chunksToDocDetail(
  slug: string,
  chunks: DocChunk[],
): DocDetailShape {
  const ordered = chunks.filter((c) => typeof c.chunk_text === 'string' || typeof c.excerpt === 'string');

  const body = ordered
    .map((c) => (typeof c.chunk_text === 'string' ? c.chunk_text : (c.excerpt as string)))
    .join('\n\n');

  const lastUpdatedCandidates = ordered
    .map((c) => (typeof c.last_updated === 'string' ? c.last_updated : null))
    .filter((v): v is string => v !== null);
  const lastModifiedAt =
    lastUpdatedCandidates.length > 0
      ? lastUpdatedCandidates.reduce((latest, current) =>
          new Date(current).getTime() > new Date(latest).getTime() ? current : latest,
        )
      : new Date(0).toISOString();

  const firstExcerpt = ordered
    .map((c) => (typeof c.excerpt === 'string' ? c.excerpt : null))
    .find((v): v is string => v !== null);

  return {
    id: slug,
    title: slug,
    source: 'notion',
    lastModifiedAt,
    tags: [],
    citationCount: 0,
    body,
    snippet: firstExcerpt ?? body.slice(0, 280),
  };
}
