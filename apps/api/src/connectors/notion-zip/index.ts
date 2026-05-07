import path from 'node:path';

import AdmZip from 'adm-zip';

import type { Connector, ConnectorSource, ExtractOptions, NormalizedDoc } from '../interface.js';

export const DEFAULT_NOTION_ZIP_LIMITS = {
  maxEntries: 2_000,
  maxEntryBytes: 5 * 1024 * 1024,
  maxTotalBytes: 75 * 1024 * 1024,
  maxCompressionRatio: 100,
};

export interface NotionZipLimits {
  maxEntries?: number;
  maxEntryBytes?: number;
  maxTotalBytes?: number;
  maxCompressionRatio?: number;
}

type ResolvedNotionZipLimits = Required<NotionZipLimits>;

const IMAGE_EXTENSIONS = new Set([
  '.apng',
  '.avif',
  '.gif',
  '.jpg',
  '.jpeg',
  '.png',
  '.svg',
  '.webp',
]);

export class NotionZipConnector implements Connector {
  readonly name = 'notion-zip';
  readonly version = '0.1.0';

  constructor(private readonly limits: NotionZipLimits = {}) {}

  async *extract(source: ConnectorSource, opts: ExtractOptions = {}): AsyncIterable<NormalizedDoc> {
    const limits = resolveLimits(this.limits);
    const zip = new AdmZip(source.zipPath);
    const entries = zip
      .getEntries()
      .filter((entry) => !entry.isDirectory && !isImage(entry.entryName));
    assertZipLimits(entries, limits);
    const slugByTarget = buildSlugMap(entries.map((entry) => entry.entryName));
    let actualTotalBytes = 0;

    for (const entry of entries) {
      opts.signal?.throwIfAborted();
      const ext = path.extname(entry.entryName).toLowerCase();
      if (!['.md', '.markdown', '.txt', '.csv'].includes(ext)) continue;

      const title = stripFilenameUuid(path.basename(entry.entryName, ext));
      const slug = slugByTarget.get(entry.entryName) ?? slugify(title);
      const { text: raw, byteLength } = readTextEntry(entry, limits);
      actualTotalBytes += byteLength;
      if (actualTotalBytes > limits.maxTotalBytes) {
        throw new Error('notion_zip_too_large');
      }
      const content = ext === '.csv' ? csvToMarkdown(raw) : normalizeMarkdown(raw, slugByTarget);

      yield {
        slug,
        title,
        content_md: content.trim() ? content.trimEnd() + '\n' : '',
        metadata: {
          source_ref: entry.entryName,
          last_modified_at: entry.header.time,
        },
      };
    }
  }
}

function resolveLimits(limits: NotionZipLimits): ResolvedNotionZipLimits {
  return { ...DEFAULT_NOTION_ZIP_LIMITS, ...limits };
}

function assertZipLimits(entries: AdmZip.IZipEntry[], limits: ResolvedNotionZipLimits): void {
  if (entries.length > limits.maxEntries) {
    throw new Error('notion_zip_too_many_entries');
  }

  let totalBytes = 0;
  for (const entry of entries) {
    const uncompressedBytes = Number(entry.header.size ?? 0);
    const compressedBytes = Math.max(Number(entry.header.compressedSize ?? 0), 1);
    totalBytes += uncompressedBytes;
    if (uncompressedBytes > limits.maxEntryBytes) {
      throw new Error('notion_zip_entry_too_large');
    }
    if (totalBytes > limits.maxTotalBytes) {
      throw new Error('notion_zip_too_large');
    }
    if (uncompressedBytes / compressedBytes > limits.maxCompressionRatio) {
      throw new Error('notion_zip_compression_ratio_too_high');
    }
  }
}

function readTextEntry(
  entry: AdmZip.IZipEntry,
  limits: ResolvedNotionZipLimits,
): { text: string; byteLength: number } {
  const data = entry.getData();
  if (data.byteLength > limits.maxEntryBytes) {
    throw new Error('notion_zip_entry_too_large');
  }
  return { text: data.toString('utf8'), byteLength: data.byteLength };
}

export function stripFilenameUuid(name: string): string {
  return name
    .replace(/\s+[0-9a-f]{32}$/i, '')
    .replace(/\s+[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, '')
    .trim();
}

export function slugify(value: string): string {
  const slug = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'untitled';
}

export function normalizeMarkdown(markdown: string, slugByTarget: Map<string, string>): string {
  return markdown
    .replace(/!\[[^\]]*]\([^)]+\)/g, '')
    .replace(/\[([^\]]+)]\(([^)]+)\)/g, (_match, label: string, href: string) => {
      const slug = resolveInternalSlug(href, slugByTarget);
      return slug ? `[${label}](${slug})` : `[${label}](${href})`;
    });
}

export function csvToMarkdown(csv: string): string {
  const rows = parseCsv(csv).filter((row) => row.some((cell) => cell.trim()));
  if (rows.length === 0) return '';
  const width = Math.max(...rows.map((row) => row.length));
  const padded = rows.map((row) => [...row, ...Array<string>(width - row.length).fill('')]);
  const [headerRow, ...bodyRows] = padded as [string[], ...string[][]];
  const header = headerRow.map(escapeTableCell);
  const body = bodyRows.map((row) => row.map(escapeTableCell));
  return [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...body.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
}

function buildSlugMap(targets: string[]): Map<string, string> {
  const map = new Map<string, string>();
  const seen = new Map<string, number>();

  for (const target of targets) {
    const ext = path.extname(target);
    const title = stripFilenameUuid(path.basename(target, ext));
    const baseSlug = slugify(title);
    const count = seen.get(baseSlug) ?? 0;
    seen.set(baseSlug, count + 1);
    const slug = count === 0 ? baseSlug : `${baseSlug}-${count + 1}`;
    const decodedTarget = decodeURIComponentSafe(target);
    const basename = path.basename(target);

    map.set(target, slug);
    map.set(decodedTarget, slug);
    map.set(basename, slug);
    map.set(decodeURIComponentSafe(basename), slug);
  }

  return map;
}

function resolveInternalSlug(href: string, slugByTarget: Map<string, string>): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return null;
  const withoutAnchor = href.replace(/^<|>$/g, '').split('#')[0] ?? '';
  const decoded = decodeURIComponentSafe(withoutAnchor);
  return (
    slugByTarget.get(withoutAnchor) ??
    slugByTarget.get(decoded) ??
    slugByTarget.get(path.basename(withoutAnchor)) ??
    slugByTarget.get(path.basename(decoded)) ??
    null
  );
}

function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    const next = csv[index + 1];
    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(cell);
      cell = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }

  row.push(cell);
  rows.push(row);
  return rows;
}

function escapeTableCell(value: string): string {
  return value.trim().replace(/\|/g, '\\|').replace(/\n/g, '<br>');
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isImage(filePath: string): boolean {
  return IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}
