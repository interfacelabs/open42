import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import AdmZip from 'adm-zip';
import { afterEach, describe, expect, it } from 'vitest';

import { NotionZipConnector, csvToMarkdown, slugify, stripFilenameUuid } from './index.js';
import type { NormalizedDoc } from '../interface.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

describe('NotionZipConnector', () => {
  it('normalizes Notion markdown, nested paths, links, CSV tables, images, and emoji', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'open42-notion-test-'));
    tempDirs.push(dir);
    const zipPath = join(dir, 'notion.zip');
    const zip = new AdmZip();
    zip.addFile(
      'Policies/Refund Policy 1234567890abcdef1234567890abcdef.md',
      Buffer.from('# Refunds 😀\nSee [Enterprise](Enterprise%20SLA%20abcdefabcdefabcdefabcdefabcdefab.md)\n![x](image.png)\n'),
    );
    zip.addFile(
      'Policies/Enterprise SLA abcdefabcdefabcdefabcdefabcdefab.md',
      Buffer.from('# Enterprise\n90 days\n'),
    );
    zip.addFile('Tables/Refund Matrix 11111111111111111111111111111111.csv', Buffer.from('Plan,Days\nPro,30\nEnterprise,90\n'));
    zip.addFile('Policies/image.png', Buffer.from('not real'));
    await writeFile(zipPath, zip.toBuffer());

    const result = new NotionZipConnector().extract({
      cursor: {},
      source: { kind: 'notion-zip', zipPath },
      workspaceId: 'test-workspace',
    });
    const docs: NormalizedDoc[] = [];
    for await (const doc of result.docs) docs.push(doc);

    expect(docs.map((doc) => doc.slug).sort()).toEqual([
      'enterprise-sla',
      'refund-matrix',
      'refund-policy',
    ]);
    const refund = docs.find((doc) => doc.slug === 'refund-policy');
    const matrix = docs.find((doc) => doc.slug === 'refund-matrix');
    expect(refund?.title).toBe('Refund Policy');
    expect(refund?.content_md).toContain('Refunds 😀');
    expect(refund?.content_md).toContain('[Enterprise](enterprise-sla)');
    expect(refund?.content_md).not.toContain('image.png');
    expect(refund?.metadata.source_ref).toBe(
      'notion-zip:Policies/Refund Policy 1234567890abcdef1234567890abcdef.md',
    );
    expect(matrix?.content_md).toContain('| Plan | Days |');
    expect(matrix?.content_md).toContain('| Enterprise | 90 |');
    expect(result.finalize()).toEqual(
      expect.objectContaining({ zipPath, importedAt: expect.any(String) }),
    );
  });

  it('exposes filename and CSV helpers', () => {
    expect(stripFilenameUuid('Refund Policy 1234567890abcdef1234567890abcdef')).toBe(
      'Refund Policy',
    );
    expect(slugify('Déjà Vu Refunds')).toBe('deja-vu-refunds');
    expect(csvToMarkdown('"A|B",C\n"x,y",z')).toContain('| A\\|B | C |');
    expect(csvToMarkdown('')).toBe('');
    expect(csvToMarkdown('"Quote"\r\n"Say ""yes"""')).toContain('Say "yes"');
  });

  it('handles unsupported files, empty docs, external links, and malformed URI links', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'open42-notion-edge-test-'));
    tempDirs.push(dir);
    const zipPath = join(dir, 'notion-edge.zip');
    const zip = new AdmZip();
    zip.addFile('Notes/Empty 22222222222222222222222222222222.txt', Buffer.from('   \n'));
    zip.addFile(
      'Notes/External Links.md',
      Buffer.from('[Site](https://example.com/policy)\n[Broken](%E0%A4%A.md)\n'),
    );
    zip.addFile('Notes/Bad%E0%A4%A.md', Buffer.from('bad uri target'));
    zip.addFile('Files/Archive.pdf', Buffer.from('%PDF'));
    await writeFile(zipPath, zip.toBuffer());

    const result = new NotionZipConnector().extract({
      cursor: {},
      source: { kind: 'notion-zip', zipPath },
      workspaceId: 'test-workspace',
    });
    const docs: NormalizedDoc[] = [];
    for await (const doc of result.docs) docs.push(doc);

    expect(docs.map((doc) => doc.slug).sort()).toEqual(['bad-e0-a4-a', 'empty', 'external-links']);
    expect(docs.find((doc) => doc.slug === 'empty')?.content_md).toBe('');
    const external = docs.find((doc) => doc.slug === 'external-links');
    expect(external?.content_md).toContain('[Site](https://example.com/policy)');
    expect(external?.content_md).toContain('[Broken](%E0%A4%A.md)');
    expect(docs.some((doc) => doc.metadata.source_ref === 'Files/Archive.pdf')).toBe(false);
  });

  it('rejects archives that exceed safety limits before decompressing content', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'open42-notion-limit-test-'));
    tempDirs.push(dir);
    const zipPath = join(dir, 'notion-limit.zip');
    const zip = new AdmZip();
    zip.addFile('Huge.md', Buffer.from('x'.repeat(128)));
    await writeFile(zipPath, zip.toBuffer());

    const connector = new NotionZipConnector({ maxEntryBytes: 64 });
    await expect(async () => {
      const result = connector.extract({
        cursor: {},
        source: { kind: 'notion-zip', zipPath },
        workspaceId: 'test-workspace',
      });
      for await (const doc of result.docs) {
        void doc;
        // Exhaust the async iterator.
      }
    }).rejects.toThrow('notion_zip_entry_too_large');
  });

  it('declares one-shot mode and returns an importedAt cursor', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'open42-notion-mode-test-'));
    tempDirs.push(dir);
    const zipPath = join(dir, 'notion-mode.zip');
    const zip = new AdmZip();
    zip.addFile('Notes/Hello.md', Buffer.from('hello'));
    await writeFile(zipPath, zip.toBuffer());

    const connector = new NotionZipConnector();
    expect(connector.mode).toBe('one_shot');
    const result = connector.extract({
      cursor: {},
      source: { kind: 'notion-zip', zipPath },
      workspaceId: 'test-workspace',
    });
    for await (const doc of result.docs) {
      expect(doc.slug).toBe('hello');
    }
    expect(result.finalize()).toEqual({
      zipPath,
      importedAt: expect.any(String),
    });
  });
});
