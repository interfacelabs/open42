import { describe, expect, it } from 'vitest';
import type {
  Connector,
  ConnectorContext,
  ExtractResult,
  NormalizedDoc,
} from './interface.js';

describe('Connector interface contract', () => {
  it('extract returns ExtractResult with docs iterable and finalize fn', async () => {
    const fakeConnector: Connector = {
      name: 'fake',
      version: '0.0.1',
      mode: 'pollable',
      extract(ctx: ConnectorContext): ExtractResult {
        const docs = (async function* (): AsyncIterable<NormalizedDoc> {
          yield {
            slug: 'doc-1',
            title: 'Doc 1',
            content_md: 'hello',
            metadata: { source_ref: 'fake:1' },
          };
        })();
        return { docs, finalize: () => ({ since: 'now' }) };
      },
    };

    const result = fakeConnector.extract({
      cursor: {},
      source: { kind: 'notion-zip', zipPath: '' },
      workspaceId: 'w1',
    });
    const collected: NormalizedDoc[] = [];
    for await (const d of result.docs) collected.push(d);
    expect(collected).toHaveLength(1);
    expect(collected[0]?.slug).toBe('doc-1');
    expect(result.finalize()).toEqual({ since: 'now' });
  });
});
