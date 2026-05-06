import { describe, expect, it } from 'vitest';
import { createFakeComposio } from '../../composio/fake.js';
import type { NormalizedDoc } from '../interface.js';
import { NotionComposioConnector } from './index.js';

function fixturePage(id: string, title: string, lastEditedTime: string) {
  return {
    id,
    title,
    url: `https://notion.so/${id}`,
    last_edited_time: lastEditedTime,
    created_by: { name: 'alice' },
  };
}

describe('NotionComposioConnector', () => {
  it('paginates NOTION_SEARCH and yields pages with stable slugs', async () => {
    const fake = createFakeComposio({
      toolHandlers: {
        NOTION_SEARCH: async ({ args }) => {
          const cursor = (args as { start_cursor?: string | null }).start_cursor ?? null;
          if (cursor === null) {
            return {
              has_more: true,
              next_cursor: 'p2',
              results: [fixturePage('id-1', 'Page One', '2026-04-01T00:00:00.000Z')],
            };
          }
          return {
            has_more: false,
            next_cursor: null,
            results: [fixturePage('id-2', 'Page Two', '2026-04-02T00:00:00.000Z')],
          };
        },
        NOTION_FETCH_PAGE_CONTENT: async ({ args }) => ({
          blocks: [
            {
              type: 'paragraph',
              paragraph: {
                rich_text: [
                  {
                    type: 'text',
                    plain_text: `body of ${(args as { page_id: string }).page_id}`,
                    text: { content: '' },
                  },
                ],
              },
            },
          ],
        }),
      },
    });

    const connector = new NotionComposioConnector(fake);
    const result = connector.extract({
      cursor: {},
      source: { kind: 'notion-composio' },
      account: { composio_connected_account_id: 'fake-acc' },
      workspaceId: 'w1',
    });

    const docs: NormalizedDoc[] = [];
    for await (const d of result.docs) docs.push(d);
    expect(docs.map((d) => d.slug)).toEqual(['notion-composio-id1', 'notion-composio-id2']);
    expect(docs[0]?.title).toBe('Page One');
    expect(docs[0]?.metadata.source_ref).toBe('notion-composio:id-1');
    expect(docs[0]?.metadata.source_url).toBe('https://notion.so/id-1');
    expect(result.finalize()).toEqual({ since_iso: '2026-04-02T00:00:00.000Z' });
  });

  it('honors descending cutoff via cursor.since_iso', async () => {
    const fake = createFakeComposio({
      toolHandlers: {
        NOTION_SEARCH: async () => ({
          has_more: false,
          next_cursor: null,
          results: [
            fixturePage('id-3', 'New', '2026-04-10T00:00:00.000Z'),
            fixturePage('id-4', 'Old', '2026-04-01T00:00:00.000Z'),
          ],
        }),
        NOTION_FETCH_PAGE_CONTENT: async () => ({ blocks: [] }),
      },
    });
    const connector = new NotionComposioConnector(fake);
    const result = connector.extract({
      cursor: { since_iso: '2026-04-05T00:00:00.000Z' },
      source: { kind: 'notion-composio' },
      account: { composio_connected_account_id: 'fake-acc' },
      workspaceId: 'w1',
    });
    const docs: NormalizedDoc[] = [];
    for await (const d of result.docs) docs.push(d);
    expect(docs).toHaveLength(1);
    expect(docs[0]?.title).toBe('New');
    expect(result.finalize()).toEqual({ since_iso: '2026-04-10T00:00:00.000Z' });
  });

  it('declares mode = pollable', () => {
    const connector = new NotionComposioConnector(createFakeComposio());
    expect(connector.mode).toBe('pollable');
  });
});
