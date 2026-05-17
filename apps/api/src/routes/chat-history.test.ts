import { describe, expect, it } from 'vitest';

import {
  bodySizeBytes,
  MAX_CHAT_HISTORY_MESSAGES,
  MAX_CHAT_HISTORY_TURNS,
  truncateHistory,
} from './chat-history.js';
import type { NormalizedMessage } from './chat-providers.js';

const msg = (content: string, role: 'user' | 'assistant' = 'user'): NormalizedMessage => ({
  role,
  content,
});

describe('truncateHistory', () => {
  it('treats the default cap as 20 prior user/assistant turns', () => {
    expect(MAX_CHAT_HISTORY_TURNS).toBe(20);
    expect(MAX_CHAT_HISTORY_MESSAGES).toBe(40);
  });

  it('keeps history that is already inside message and token caps', () => {
    const history = [msg('first'), msg('second', 'assistant')];

    expect(truncateHistory({ messages: history, maxMessages: 20, maxTokens: 20 })).toEqual(history);
  });

  it('evicts oldest messages when the message cap is exceeded', () => {
    const history = [msg('one'), msg('two'), msg('three')];

    expect(truncateHistory({ messages: history, maxMessages: 2, maxTokens: 100 })).toEqual([
      msg('two'),
      msg('three'),
    ]);
  });

  it('evicts oldest complete turns until the token cap is satisfied', () => {
    const history = [
      msg('a'.repeat(20)),
      msg('b'.repeat(12), 'assistant'),
      msg('monthly?'),
      msg('tiny', 'assistant'),
    ];

    expect(truncateHistory({ messages: history, maxMessages: 20, maxTokens: 3 })).toEqual([
      msg('monthly?'),
      msg('tiny', 'assistant'),
    ]);
  });

  it('returns an empty array for empty history', () => {
    expect(truncateHistory({ messages: [], maxMessages: 20, maxTokens: 20 })).toEqual([]);
  });

  it('keeps the newest complete turn when both caps apply', () => {
    const history = [
      msg('old'),
      msg('older assistant', 'assistant'),
      msg('middle'.repeat(10)),
      msg('middle assistant'.repeat(10), 'assistant'),
      msg('new'),
      msg('new assistant', 'assistant'),
    ];

    expect(truncateHistory({ messages: history, maxMessages: 2, maxTokens: 5 })).toEqual([
      msg('new'),
      msg('new assistant', 'assistant'),
    ]);
  });
});

describe('bodySizeBytes', () => {
  it('counts the serialized request body in utf8 bytes', () => {
    expect(bodySizeBytes({ query: 'hello' })).toBe(Buffer.byteLength('{"query":"hello"}'));
  });
});
