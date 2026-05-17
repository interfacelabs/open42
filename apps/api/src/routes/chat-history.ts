import { countTokensInMessages } from './chat-budget.js';
import type { NormalizedMessage } from './chat-providers.js';

export const MAX_CHAT_HISTORY_TURNS = 20;
export const MAX_CHAT_HISTORY_MESSAGES = MAX_CHAT_HISTORY_TURNS * 2;
export const MAX_CHAT_HISTORY_TOKENS = 8_000;
export const MAX_CHAT_BODY_BYTES = 100 * 1024;

export interface TruncateHistoryInput {
  messages: NormalizedMessage[];
  maxMessages?: number;
  maxTokens?: number;
}

export function truncateHistory(input: TruncateHistoryInput): NormalizedMessage[] {
  const maxMessages = input.maxMessages ?? MAX_CHAT_HISTORY_MESSAGES;
  const maxTokens = input.maxTokens ?? MAX_CHAT_HISTORY_TOKENS;
  const candidates = input.messages.slice(-maxMessages);

  while (candidates.length > 0 && countTokensInMessages(candidates) > maxTokens) {
    dropOldestTurn(candidates);
  }

  return candidates;
}

export function bodySizeBytes(body: unknown): number {
  return Buffer.byteLength(JSON.stringify(body ?? {}), 'utf8');
}

function dropOldestTurn(messages: NormalizedMessage[]): void {
  if (messages.length >= 2 && messages[0]?.role === 'user' && messages[1]?.role === 'assistant') {
    messages.splice(0, 2);
    return;
  }
  messages.shift();
}
