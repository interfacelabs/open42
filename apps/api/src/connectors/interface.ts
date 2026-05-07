export interface NormalizedDoc {
  slug: string;
  title: string;
  content_md: string;
  metadata: {
    source_ref: string;
    source_url?: string;
    last_modified_at?: Date;
    tags?: string[];
    author?: string;
    title?: string;
  };
}

export interface IngestProgress {
  pages_total: number;
  state:
    | 'extracting'
    | 'normalizing'
    | 'submitted_to_gbrain'
    | 'gbrain_processing'
    | 'completed'
    | 'failed';
  message?: string;
}

export type ConnectorSource =
  | { kind: 'notion-zip'; zipPath: string }
  | { kind: 'notion-composio' };

export interface ConnectorContext {
  cursor: Record<string, unknown>;
  source: ConnectorSource;
  account?: { composio_connected_account_id: string };
  workspaceId: string;
}

export interface ExtractOptions {
  signal?: AbortSignal;
}

export interface ExtractResult {
  docs: AsyncIterable<NormalizedDoc>;
  finalize(): Record<string, unknown>;
}

export interface Connector {
  readonly name: string;
  readonly version: string;
  readonly mode: 'one_shot' | 'pollable';
  extract(ctx: ConnectorContext, opts?: ExtractOptions): ExtractResult;
}
