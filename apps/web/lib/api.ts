/**
 * Shared SWR fetcher and time helpers for the authenticated dashboard surfaces.
 * Pages that hit /api/workspaces/current dedupe through SWR's cache key.
 */

export type FetchError = Error & { status?: number };

export async function fetcher<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    const error = new Error('fetch_failed') as FetchError;
    error.status = response.status;
    throw error;
  }
  return (await response.json()) as T;
}

export function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'never';
  const diff = Date.now() - then;
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function sourceLabel(kind: string): string {
  if (kind === 'notion-composio') return 'Notion';
  if (kind === 'notion-zip') return 'Notion · zip';
  return kind;
}

/**
 * Maps a connection kind (`notion-composio` / `notion-zip`) onto the source
 * key used in the Library API. Multiple connection kinds can collapse onto
 * one source surface (both Notion variants → `notion`).
 */
export function sourceKey(kind: string): string {
  if (kind.startsWith('notion-')) return 'notion';
  return kind;
}
