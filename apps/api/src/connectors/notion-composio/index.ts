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

export class NotionComposioConnector implements Connector {
  readonly name = 'notion-composio';
  readonly version = '0.1.0';
  readonly mode = 'pollable' as const;

  constructor(private readonly composio: ComposioClient) {}

  extract(ctx: ConnectorContext, opts?: ExtractOptions): ExtractResult {
    if (ctx.source.kind !== 'notion-composio') {
      throw new Error(`notion-composio connector cannot accept source kind ${ctx.source.kind}`);
    }
    const since = (ctx.cursor.since_iso as string | undefined) ?? null;
    let maxSeen: string | null = since;
    const composio = this.composio;
    const account = ctx.account?.composio_connected_account_id;
    if (!account) {
      throw new Error('notion-composio connector requires account.composio_connected_account_id');
    }

    const docs = (async function* (): AsyncIterable<NormalizedDoc> {
      let pageCursor: string | null = null;
      while (true) {
        opts?.signal?.throwIfAborted();
        const res: NotionSearchResult = await composio.executeTool<NotionSearchResult>({
          tool: 'NOTION_SEARCH',
          account,
          args: {
            filter: { property: 'object', value: 'page' },
            sort: { timestamp: 'last_edited_time', direction: 'descending' },
            start_cursor: pageCursor,
          },
        });
        for (const item of res.results) {
          opts?.signal?.throwIfAborted();
          if (since && item.last_edited_time < since) return;
          const content = await composio.executeTool<NotionPageContent>({
            tool: 'NOTION_FETCH_PAGE_CONTENT',
            account,
            args: { page_id: item.id },
          });
          const title = item.title ?? '';
          const lastModifiedAt = validDate(item.last_edited_time);
          yield {
            slug: notionPageSlug(item.id),
            title,
            content_md: blocksToMarkdown(content.blocks ?? []),
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
        }
        if (!res.has_more) break;
        pageCursor = res.next_cursor;
      }
    })();

    return {
      docs,
      finalize: () => (maxSeen ? { since_iso: maxSeen } : {}),
    };
  }
}

function validDate(value: string): Date | undefined {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}
