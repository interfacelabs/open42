import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { docStagingPath } from './doc-path.js';

describe('docStagingPath', () => {
  const dirs: string[] = [];

  afterEach(async () => {
    for (const dir of dirs.splice(0)) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('returns a markdown path inside the connection staging directory for safe slugs', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'open42-doc-path-'));
    dirs.push(dir);
    expect(docStagingPath(dir, 'refund-policy-2026')).toBe(join(dir, 'refund-policy-2026.md'));
  });

  it.each(['../secret', 'secret/child', 'secret.child', '-secret', 'secret-', 'Secret'])(
    'rejects unsafe slug %j',
    (slug) => {
      expect(() => docStagingPath('/tmp/open42', slug)).toThrow('ingest_doc_slug_invalid');
    },
  );
});
