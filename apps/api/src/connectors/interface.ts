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
  };
}

export interface IngestProgress {
  pages_total: number;
  pages_processed: number;
  state:
    | 'extracting'
    | 'normalizing'
    | 'submitted_to_gbrain'
    | 'gbrain_processing'
    | 'completed'
    | 'failed';
  message?: string;
}

export interface ConnectorSource {
  zipPath: string;
}

export interface ExtractOptions {
  signal?: AbortSignal;
}

export interface Connector {
  readonly name: string;
  readonly version: string;
  extract(source: ConnectorSource, opts?: ExtractOptions): AsyncIterable<NormalizedDoc>;
}
