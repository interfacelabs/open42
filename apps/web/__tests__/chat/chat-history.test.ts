import { describe, expect, it } from 'vitest';

import type { ChatMessage } from '@/components/chat-types';
import { buildChatRequestHistory } from '@/lib/chat-history';

describe('buildChatRequestHistory', () => {
  it('sends clean prior user and assistant turns for a normal follow-up', () => {
    const messages: ChatMessage[] = [
      { id: 'system-1', role: 'system', text: 'Use citations.' },
      { id: 'u1', role: 'user', text: 'What is the annual refund window?' },
      { id: 'a1', role: 'assistant', text: 'Annual customers have 30 days [1].' },
    ];

    expect(buildChatRequestHistory(messages)).toEqual([
      { role: 'user', text: 'What is the annual refund window?' },
      { role: 'assistant', text: 'Annual customers have 30 days [1].' },
    ]);
  });

  it('excludes the failed assistant and its paired user question on retry', () => {
    const messages: ChatMessage[] = [
      { id: 'u1', role: 'user', text: 'What is the annual refund window?' },
      { id: 'a1', role: 'assistant', text: 'Annual customers have 30 days [1].' },
      { id: 'u2', role: 'user', text: 'What about monthly customers?' },
      {
        id: 'a2',
        role: 'assistant',
        text: '',
        error: 'provider_stream_failed',
        retryQuery: 'What about monthly customers?',
      },
    ];

    expect(buildChatRequestHistory(messages, 'a2')).toEqual([
      { role: 'user', text: 'What is the annual refund window?' },
      { role: 'assistant', text: 'Annual customers have 30 days [1].' },
    ]);
  });

  it('caps history to the newest 20 non-empty non-error turns', () => {
    const messages: ChatMessage[] = Array.from({ length: 22 }, (_, index) => ({
      id: `m${index}`,
      role: index % 2 === 0 ? 'user' : 'assistant',
      text: `turn ${index}`,
    }));

    const history = buildChatRequestHistory(messages);

    expect(history).toHaveLength(20);
    expect(history[0]).toEqual({ role: 'user', text: 'turn 2' });
    expect(history.at(-1)).toEqual({ role: 'assistant', text: 'turn 21' });
  });
});
