export interface NotionRichText {
  type: 'text';
  plain_text: string;
  text: {
    content: string;
    link?: { url: string };
  };
  annotations?: {
    bold?: boolean;
    italic?: boolean;
    code?: boolean;
    strikethrough?: boolean;
  };
}

export type NotionBlock =
  | { type: 'paragraph'; paragraph: { rich_text: NotionRichText[] } }
  | { type: 'heading_1'; heading_1: { rich_text: NotionRichText[] } }
  | { type: 'heading_2'; heading_2: { rich_text: NotionRichText[] } }
  | { type: 'heading_3'; heading_3: { rich_text: NotionRichText[] } }
  | { type: 'bulleted_list_item'; bulleted_list_item: { rich_text: NotionRichText[] } }
  | { type: 'numbered_list_item'; numbered_list_item: { rich_text: NotionRichText[] } }
  | { type: 'code'; code: { language?: string; rich_text: NotionRichText[] } }
  | { type: 'quote'; quote: { rich_text: NotionRichText[] } }
  | { type: 'callout'; callout: { rich_text: NotionRichText[] } }
  | { type: 'divider'; divider: Record<string, never> }
  | { type: 'image'; image: { caption?: NotionRichText[] } }
  | { type: string; [k: string]: unknown };

function renderRichText(parts: NotionRichText[] | undefined): string {
  if (!parts) return '';
  return parts
    .map((rt) => {
      let text = rt.plain_text ?? rt.text?.content ?? '';
      const ann = rt.annotations ?? {};
      if (ann.code) text = `\`${text}\``;
      if (ann.bold) text = `**${text}**`;
      if (ann.italic) text = `*${text}*`;
      if (ann.strikethrough) text = `~~${text}~~`;
      const link = rt.text?.link?.url;
      if (link) text = `[${text}](${link})`;
      return text;
    })
    .join('');
}

export function blocksToMarkdown(blocks: NotionBlock[]): string {
  const out: string[] = [];
  let prevWasListItem: 'bulleted' | 'numbered' | null = null;

  for (const block of blocks) {
    let line = '';
    let isListItem: 'bulleted' | 'numbered' | null = null;

    switch (block.type) {
      case 'paragraph':
        line = renderRichText(
          (block as Extract<NotionBlock, { type: 'paragraph' }>).paragraph.rich_text,
        );
        break;
      case 'heading_1':
        line = `# ${renderRichText(
          (block as Extract<NotionBlock, { type: 'heading_1' }>).heading_1.rich_text,
        )}`;
        break;
      case 'heading_2':
        line = `## ${renderRichText(
          (block as Extract<NotionBlock, { type: 'heading_2' }>).heading_2.rich_text,
        )}`;
        break;
      case 'heading_3':
        line = `### ${renderRichText(
          (block as Extract<NotionBlock, { type: 'heading_3' }>).heading_3.rich_text,
        )}`;
        break;
      case 'bulleted_list_item':
        line = `- ${renderRichText(
          (block as Extract<NotionBlock, { type: 'bulleted_list_item' }>).bulleted_list_item
            .rich_text,
        )}`;
        isListItem = 'bulleted';
        break;
      case 'numbered_list_item':
        line = `1. ${renderRichText(
          (block as Extract<NotionBlock, { type: 'numbered_list_item' }>).numbered_list_item
            .rich_text,
        )}`;
        isListItem = 'numbered';
        break;
      case 'code': {
        const code = (block as Extract<NotionBlock, { type: 'code' }>).code;
        const lang = code.language ?? '';
        line = `\`\`\`${lang}\n${renderRichText(code.rich_text)}\n\`\`\``;
        break;
      }
      case 'quote':
        line = `> ${renderRichText(
          (block as Extract<NotionBlock, { type: 'quote' }>).quote.rich_text,
        )}`;
        break;
      case 'callout':
        line = `> ${renderRichText(
          (block as Extract<NotionBlock, { type: 'callout' }>).callout.rich_text,
        )}`;
        break;
      case 'divider':
        line = '---';
        break;
      case 'image':
        line = `![${renderRichText(
          (block as Extract<NotionBlock, { type: 'image' }>).image.caption,
        )}]`;
        break;
      default:
        line = '';
    }

    if (line === '') {
      prevWasListItem = null;
      continue;
    }

    if (out.length > 0) {
      if (isListItem && prevWasListItem === isListItem) {
        out.push('\n');
      } else {
        out.push('\n\n');
      }
    }
    out.push(line);
    prevWasListItem = isListItem;
  }

  if (out.length === 0) return '';
  return `${out.join('')}\n`;
}
