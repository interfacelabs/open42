import { describe, expect, it } from 'vitest';
import { blocksToMarkdown, type NotionBlock } from './blocks-to-md.js';

const para = (text: string): NotionBlock => ({
  type: 'paragraph',
  paragraph: { rich_text: [{ type: 'text', plain_text: text, text: { content: text } }] },
});

describe('blocksToMarkdown', () => {
  it('renders paragraph', () => {
    expect(blocksToMarkdown([para('Hello world')])).toBe('Hello world\n');
  });

  it('renders headings 1-3', () => {
    const blocks: NotionBlock[] = [
      { type: 'heading_1', heading_1: { rich_text: [{ type: 'text', plain_text: 'H1', text: { content: 'H1' } }] } },
      { type: 'heading_2', heading_2: { rich_text: [{ type: 'text', plain_text: 'H2', text: { content: 'H2' } }] } },
      { type: 'heading_3', heading_3: { rich_text: [{ type: 'text', plain_text: 'H3', text: { content: 'H3' } }] } },
    ];
    expect(blocksToMarkdown(blocks)).toBe('# H1\n\n## H2\n\n### H3\n');
  });

  it('renders bulleted and numbered lists', () => {
    const blocks: NotionBlock[] = [
      { type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ type: 'text', plain_text: 'one', text: { content: 'one' } }] } },
      { type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ type: 'text', plain_text: 'two', text: { content: 'two' } }] } },
      { type: 'numbered_list_item', numbered_list_item: { rich_text: [{ type: 'text', plain_text: 'first', text: { content: 'first' } }] } },
    ];
    expect(blocksToMarkdown(blocks)).toBe('- one\n- two\n\n1. first\n');
  });

  it('renders code block with language', () => {
    const blocks: NotionBlock[] = [
      {
        type: 'code',
        code: {
          language: 'ts',
          rich_text: [{ type: 'text', plain_text: 'const x = 1;', text: { content: 'const x = 1;' } }],
        },
      },
    ];
    expect(blocksToMarkdown(blocks)).toBe('```ts\nconst x = 1;\n```\n');
  });

  it('renders quote and callout', () => {
    const blocks: NotionBlock[] = [
      { type: 'quote', quote: { rich_text: [{ type: 'text', plain_text: 'wisdom', text: { content: 'wisdom' } }] } },
      { type: 'callout', callout: { rich_text: [{ type: 'text', plain_text: 'note', text: { content: 'note' } }] } },
    ];
    expect(blocksToMarkdown(blocks)).toBe('> wisdom\n\n> note\n');
  });

  it('renders divider', () => {
    expect(blocksToMarkdown([{ type: 'divider', divider: {} }])).toBe('---\n');
  });

  it('renders image alt-text only', () => {
    const block: NotionBlock = {
      type: 'image',
      image: { caption: [{ type: 'text', plain_text: 'cute cat', text: { content: 'cute cat' } }] },
    };
    expect(blocksToMarkdown([block])).toBe('![cute cat]\n');
  });

  it('renders inline links', () => {
    const block: NotionBlock = {
      type: 'paragraph',
      paragraph: {
        rich_text: [
          {
            type: 'text',
            plain_text: 'click',
            text: { content: 'click', link: { url: 'https://example.com' } },
          },
        ],
      },
    };
    expect(blocksToMarkdown([block])).toBe('[click](https://example.com)\n');
  });

  it('flattens unsupported blocks to empty string but keeps the rest', () => {
    const blocks: NotionBlock[] = [
      para('before'),
      { type: 'unsupported_kind', unsupported_kind: {} } as unknown as NotionBlock,
      para('after'),
    ];
    expect(blocksToMarkdown(blocks)).toBe('before\n\nafter\n');
  });
});
