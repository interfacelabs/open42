export function notionPageSlug(pageId: string): string {
  const compact = pageId.replace(/-/g, '').toLowerCase();
  return `notion-composio-${compact}`;
}
