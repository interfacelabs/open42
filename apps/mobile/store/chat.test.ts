import { beforeEach, expect, it } from 'vitest';

import { useChatStore } from './chat';

beforeEach(() => {
  useChatStore.getState().clear();
});

it('appends messages, streams token text, patches citations, and clears state', () => {
  useChatStore.getState().appendMessage({ id: 'u-1', role: 'user', text: 'What changed?' });
  useChatStore.getState().appendMessage({ id: 'a-1', role: 'assistant', text: '', citations: [] });

  useChatStore.getState().appendToken('a-1', 'Refund policy ');
  useChatStore.getState().appendToken('a-1', 'changed [1].');
  useChatStore.getState().updateMessage('a-1', {
    citations: [
      {
        index: 1,
        slug: 'refund-policy',
        version_id: 2,
        last_updated: '2026-05-17T00:00:00.000Z',
        excerpt: 'Refund policy changed.',
      },
    ],
  });
  useChatStore.getState().setSending(true);
  useChatStore.getState().setActiveCitation(useChatStore.getState().messages[1]!.citations![0]!);

  expect(useChatStore.getState()).toMatchObject({
    sending: true,
    activeCitation: { slug: 'refund-policy' },
    messages: [
      { id: 'u-1', role: 'user', text: 'What changed?' },
      {
        id: 'a-1',
        role: 'assistant',
        text: 'Refund policy changed [1].',
        citations: [{ slug: 'refund-policy' }],
      },
    ],
  });

  useChatStore.getState().clear();

  expect(useChatStore.getState()).toMatchObject({
    messages: [],
    sending: false,
    activeCitation: null,
  });
});
