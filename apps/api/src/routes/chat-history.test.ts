import { describe, expect, it } from 'vitest';

import { bodySizeBytes, truncateHistory } from './chat-history.js';
import type { NormalizedMessage } from './chat-providers.js';

const msg = (content: string, role: 'user' | 'assistant' = 'user'): NormalizedMessage => ({
  role,
  content,
});

describe('truncateHistory', () => {
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

  it('evicts oldest messages until the token cap is satisfied', () => {
    const history = [msg('a'.repeat(20)), msg('b'.repeat(12)), msg('tiny')];

    expect(truncateHistory({ messages: history, maxMessages: 20, maxTokens: 1 })).toEqual([
      msg('tiny'),
    ]);
  });

  it('returns an empty array for empty history', () => {
    expect(truncateHistory({ messages: [], maxMessages: 20, maxTokens: 20 })).toEqual([]);
  });

  it('keeps the newest messages when both caps apply', () => {
    const history = [msg('old'), msg('middle'.repeat(10)), msg('new')];

    expect(truncateHistory({ messages: history, maxMessages: 2, maxTokens: 1 })).toEqual([
      msg('new'),
    ]);
  });
});

describe('bodySizeBytes', () => {
  it('counts the serialized request body in utf8 bytes', () => {
    expect(bodySizeBytes({ query: 'hello' })).toBe(Buffer.byteLength('{"query":"hello"}'));
  });
});
