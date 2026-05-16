import type { ComposioClient } from '../composio/client.js';
import type { Connector } from './interface.js';
import { NotionComposioConnector } from './notion-composio/index.js';
import { NotionZipConnector } from './notion-zip/index.js';

export function makeConnectorRegistry(composio: ComposioClient | null): {
  resolveConnectorByKind(kind: string, opts?: { composio?: ComposioClient | null }): Connector;
} {
  return {
    resolveConnectorByKind(kind: string, opts?: { composio?: ComposioClient | null }): Connector {
      switch (kind) {
        case 'notion-zip':
          return new NotionZipConnector();
        case 'notion-composio':
          if (!opts?.composio && !composio) throw new Error('composio_not_configured');
          return new NotionComposioConnector(opts?.composio ?? composio!);
        default:
          throw new Error(`Unknown connector kind: ${kind}`);
      }
    },
  };
}
