export function notionPageSlug(pageId: string): string {
  const normalized = pageId.trim();
  if (!/^[a-z0-9-]{1,128}$/i.test(normalized)) {
    throw new Error('notion_page_id_invalid');
  }
  const compact = normalized.replace(/-/g, '').toLowerCase();
  if (!compact) {
    throw new Error('notion_page_id_invalid');
  }
  return `notion-composio-${compact}`;
}
