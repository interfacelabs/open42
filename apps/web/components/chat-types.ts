export interface Citation {
  index: number;
  slug: string;
  version_id: number | null;
  last_updated: string | null;
  excerpt: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  citations?: Citation[];
  error?: string;
  retryQuery?: string;
}
