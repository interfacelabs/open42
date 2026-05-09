import { isAbsolute, relative, resolve } from 'node:path';

export const SAFE_DOC_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?$/;

export function docStagingPath(connDir: string, slug: string): string {
  if (!SAFE_DOC_SLUG_PATTERN.test(slug)) {
    throw new Error('ingest_doc_slug_invalid');
  }

  const root = resolve(connDir);
  const target = resolve(root, `${slug}.md`);
  const rel = relative(root, target);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('ingest_doc_path_invalid');
  }
  return target;
}
