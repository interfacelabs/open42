import type { ComposioClient } from '../../composio/client.js';
import type {
  Connector,
  ConnectorContext,
  ExtractOptions,
  ExtractResult,
  NormalizedDoc,
} from '../interface.js';
import { blocksToMarkdown, type NotionBlock } from './blocks-to-md.js';
import { notionPageSlug } from './slug.js';

interface NotionSearchResult {
  has_more: boolean;
  next_cursor: string | null;
  results: Array<{
    id: string;
    title?: string;
    url?: string;
    last_edited_time: string;
    created_by?: { name?: string };
  }>;
}

interface NotionPageContent {
  blocks: NotionBlock[];
}

export interface NotionComposioLimits {
  maxPagesPerCycle?: number;
  maxBlocksPerPage?: number;
  maxContentBytesPerPage?: number;
  maxTotalContentBytes?: number;
  maxCycleMs?: number;
  now?: () => number;
}

export interface ResolvedNotionComposioLimits {
  maxPagesPerCycle: number;
  maxBlocksPerPage: number;
  maxContentBytesPerPage: number;
  maxTotalContentBytes: number;
  maxCycleMs: number;
  now: () => number;
}

export const DEFAULT_NOTION_COMPOSIO_LIMITS: ResolvedNotionComposioLimits = {
  maxPagesPerCycle: 500,
  maxBlocksPerPage: 2000,
  maxContentBytesPerPage: 1_000_000,
  maxTotalContentBytes: 25_000_000,
  maxCycleMs: 5 * 60_000,
  now: Date.now,
};

export class NotionComposioConnector implements Connector {
  readonly name = 'notion-composio';
  readonly version = '0.1.0';
  readonly mode = 'pollable' as const;

  constructor(
    private readonly composio: ComposioClient,
    private readonly configuredLimits: NotionComposioLimits = {},
  ) {}

  extract(ctx: ConnectorContext, opts?: ExtractOptions): ExtractResult {
    if (ctx.source.kind !== 'notion-composio') {
      throw new Error(`notion-composio connector cannot accept source kind ${ctx.source.kind}`);
    }
    const persistedSince = stringCursor(ctx.cursor.since_iso);
    const resumePageCursor = stringCursor(ctx.cursor.page_cursor);
    const cycleSince = resumePageCursor
      ? (stringCursor(ctx.cursor.cycle_since_iso) ?? persistedSince)
      : persistedSince;
    let maxSeen: string | null = resumePageCursor
      ? (stringCursor(ctx.cursor.cycle_max_seen_iso) ?? persistedSince)
      : persistedSince;
    let pendingPageCursor: string | null = null;
    const composio = this.composio;
    const limits = resolveLimits(this.configuredLimits);
    const startedAt = limits.now();
    const account = ctx.account?.composio_connected_account_id;
    if (!account) {
      throw new Error('notion-composio connector requires account.composio_connected_account_id');
    }

    const docs = (async function* (): AsyncIterable<NormalizedDoc> {
      let pageCursor: string | null = resumePageCursor;
      let pagesProcessed = 0;
      let totalContentBytes = 0;
      while (true) {
        opts?.signal?.throwIfAborted();
        throwIfCycleExpired(limits, startedAt);
        const remainingPages = limits.maxPagesPerCycle - pagesProcessed;
        if (remainingPages <= 0) {
          pendingPageCursor = pageCursor;
          return;
        }
        const res: NotionSearchResult = await composio.executeTool<NotionSearchResult>({
          tool: 'NOTION_SEARCH',
          account,
          args: {
            filter: { property: 'object', value: 'page' },
            sort: { timestamp: 'last_edited_time', direction: 'descending' },
            start_cursor: pageCursor,
            page_size: Math.min(100, remainingPages),
          },
        });
        for (const item of res.results ?? []) {
          opts?.signal?.throwIfAborted();
          throwIfCycleExpired(limits, startedAt);
          if (cycleSince && item.last_edited_time < cycleSince) {
            pendingPageCursor = null;
            return;
          }
          const content = await composio.executeTool<NotionPageContent>({
            tool: 'NOTION_FETCH_PAGE_CONTENT',
            account,
            args: { page_id: item.id },
          });
          const title = item.title ?? '';
          const lastModifiedAt = validDate(item.last_edited_time);
          const blocks = (content.blocks ?? []).slice(0, limits.maxBlocksPerPage);
          const contentMd = truncateToUtf8Bytes(
            blocksToMarkdown(blocks),
            limits.maxContentBytesPerPage,
          );
          const contentBytes = Buffer.byteLength(contentMd, 'utf8');
          if (totalContentBytes + contentBytes > limits.maxTotalContentBytes) {
            throw new Error('notion_composio_content_budget_exceeded');
          }
          totalContentBytes += contentBytes;
          yield {
            slug: notionPageSlug(item.id),
            title,
            content_md: contentMd,
            metadata: {
              source_ref: `notion-composio:${item.id}`,
              source_url: item.url,
              last_modified_at: lastModifiedAt,
              author: item.created_by?.name,
              title,
            },
          };
          if (!maxSeen || item.last_edited_time > maxSeen) {
            maxSeen = item.last_edited_time;
          }
          pagesProcessed += 1;
        }
        if (!res.has_more) {
          pendingPageCursor = null;
          break;
        }
        if (!res.next_cursor) {
          throw new Error('notion_composio_missing_next_cursor');
        }
        pageCursor = res.next_cursor;
        if (pagesProcessed >= limits.maxPagesPerCycle) {
          pendingPageCursor = pageCursor;
          return;
        }
      }
    })();

    return {
      docs,
      finalize: () => finalizeCursor({ persistedSince, cycleSince, maxSeen, pendingPageCursor }),
    };
  }
}

function finalizeCursor(input: {
  persistedSince: string | null;
  cycleSince: string | null;
  maxSeen: string | null;
  pendingPageCursor: string | null;
}): Record<string, unknown> {
  if (input.pendingPageCursor) {
    return omitNullish({
      since_iso: input.persistedSince,
      page_cursor: input.pendingPageCursor,
      cycle_since_iso: input.cycleSince,
      cycle_max_seen_iso: input.maxSeen,
    });
  }
  return input.maxSeen ? { since_iso: input.maxSeen } : {};
}

function resolveLimits(input: NotionComposioLimits): ResolvedNotionComposioLimits {
  return {
    maxPagesPerCycle: positiveInt(
      input.maxPagesPerCycle,
      DEFAULT_NOTION_COMPOSIO_LIMITS.maxPagesPerCycle,
    ),
    maxBlocksPerPage: positiveInt(
      input.maxBlocksPerPage,
      DEFAULT_NOTION_COMPOSIO_LIMITS.maxBlocksPerPage,
    ),
    maxContentBytesPerPage: positiveInt(
      input.maxContentBytesPerPage,
      DEFAULT_NOTION_COMPOSIO_LIMITS.maxContentBytesPerPage,
    ),
    maxTotalContentBytes: positiveInt(
      input.maxTotalContentBytes,
      DEFAULT_NOTION_COMPOSIO_LIMITS.maxTotalContentBytes,
    ),
    maxCycleMs: positiveInt(input.maxCycleMs, DEFAULT_NOTION_COMPOSIO_LIMITS.maxCycleMs),
    now: input.now ?? DEFAULT_NOTION_COMPOSIO_LIMITS.now,
  };
}

function positiveInt(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function stringCursor(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function omitNullish(input: Record<string, string | null>): Record<string, string> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== null)) as Record<
    string,
    string
  >;
}

function throwIfCycleExpired(limits: ResolvedNotionComposioLimits, startedAt: number): void {
  if (limits.now() - startedAt > limits.maxCycleMs) {
    throw new Error('notion_composio_cycle_time_budget_exceeded');
  }
}

function truncateToUtf8Bytes(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) return value;
  let bytes = 0;
  let out = '';
  for (const char of value) {
    const nextBytes = Buffer.byteLength(char, 'utf8');
    if (bytes + nextBytes > maxBytes) break;
    out += char;
    bytes += nextBytes;
  }
  return out;
}

function validDate(value: string): Date | undefined {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}
