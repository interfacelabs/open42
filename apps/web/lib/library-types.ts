/**
 * Shape of a single document surfaced in the Library.
 *
 * Served by the web proxy at /pages/api/workspaces/[id]/library, which forwards
 * to apps/api `/workspaces/:id/library` (gbrain-backed; membership enforced via
 * requireMembership). See thoughts/2026-05-09/dashboard-redesign.md, P4c.
 */
export interface LibraryDoc {
  id: string;
  title: string;
  source: string;
  sourceUrl?: string;
  author?: string;
  /** ISO timestamp from gbrain's last_modified_at. */
  lastModifiedAt: string;
  tags: string[];
  /** Number of asks that cite this doc. Computed Open42-side. */
  citationCount: number;
  /** Short preview, ~280 chars. Backend may omit it on the list view. */
  snippet?: string;
  /** Full body for the slide-in detail panel. */
  body?: string;
}

export interface LibraryCollection {
  id: string;
  name: string;
  description: string;
}

export const LIBRARY_COLLECTIONS: LibraryCollection[] = [
  {
    id: 'recently-changed',
    name: 'Recently changed',
    description: 'Sorted by last-modified, freshest first.',
  },
  {
    id: 'most-cited',
    name: 'Most cited',
    description: 'Ranked by citation count across asks.',
  },
  {
    id: 'stale',
    name: 'Stale (>90d)',
    description: 'Last touched more than 90 days ago.',
  },
  {
    id: 'untagged',
    name: 'Untagged',
    description: 'No tags assigned yet.',
  },
  {
    id: 'cited-in-skills',
    name: 'Cited in skills',
    description: 'Referenced by an exported skill bundle.',
  },
];

export function findCollection(id: string): LibraryCollection | undefined {
  return LIBRARY_COLLECTIONS.find((c) => c.id === id);
}

/**
 * Freshness bucket. Stale data flags itself; freshness is visible by default.
 *   <90d   → fresh
 *   90–365d → soft warning
 *   >365d  → strong warning
 */
export type Freshness = 'fresh' | 'aging' | 'stale';

export function freshnessOf(iso: string): Freshness {
  const ageDays = (Date.now() - new Date(iso).getTime()) / 86_400_000;
  if (ageDays > 365) return 'stale';
  if (ageDays > 90) return 'aging';
  return 'fresh';
}
