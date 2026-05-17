import { beforeEach, expect, it, vi } from 'vitest';

import { useAuthStore } from '@/store/auth';
import { useChatStore } from '@/store/chat';
import { act, findTextInputByPlaceholder, render } from '@/test/render';
import { rawApiFetch } from '@/utils/api';

import { ChatScreen } from './ChatScreen';

const authState = {
  currentWorkspaceId: 'ws-1',
};

const chatState = {
  messages: [],
  sending: false,
  activeCitation: null,
  appendMessage: vi.fn(),
  updateMessage: vi.fn(),
  appendToken: vi.fn(),
  setSending: vi.fn((value: boolean) => {
    chatState.sending = value;
  }),
  setActiveCitation: vi.fn(),
};

vi.mock('@/store/auth', () => {
  const useAuthStore = Object.assign(
    (selector: (state: typeof authState) => unknown) => selector(authState),
    {
      setState: (patch: Partial<typeof authState>) => Object.assign(authState, patch),
    }
  );
  return { useAuthStore };
});

vi.mock('@/store/chat', () => {
  const useChatStore = Object.assign(
    (selector: (state: typeof chatState) => unknown) => selector(chatState),
    {
      setState: (patch: Partial<typeof chatState>) => Object.assign(chatState, patch),
    }
  );
  return { useChatStore };
});

vi.mock('@/utils/api', async () => {
  const actual = await vi.importActual<typeof import('@/utils/api')>('@/utils/api');
  return {
    ...actual,
    rawApiFetch: vi.fn(async () => ({
      ok: true,
      body: null,
      text: async () =>
        [
          JSON.stringify({
            type: 'citations',
            citations: [
              {
                index: 1,
                slug: 'refund-policy',
                version_id: 2,
                last_updated: '2026-05-01T00:00:00.000Z',
                excerpt: 'Enterprise refunds are allowed.',
              },
            ],
          }),
          JSON.stringify({ type: 'token', text: 'Enterprise refunds are allowed [1].' }),
          JSON.stringify({ type: 'done' }),
        ].join('\n'),
    })),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ currentWorkspaceId: 'ws-1' });
  useChatStore.setState({ messages: [], sending: false, activeCitation: null });
});

it('sends a chat query and renders streamed citations', async () => {
  const tree = render(
    <ChatScreen navigation={{} as any} route={{ key: 'ChatTab', name: 'ChatTab' }} />
  );

  await act(async () => {
    findTextInputByPlaceholder(tree.root, 'Ask the brain...').props.onChangeText(
      'What is our refund policy?'
    );
  });
  const sendButton = tree.root.findAll((node) => node.props.accessibilityLabel === 'Send')[0]!;
  await act(async () => {
    await sendButton.props.onPress();
  });

  expect(rawApiFetch).toHaveBeenCalledWith(
    '/chat',
    expect.objectContaining({
      method: 'POST',
      reactNative: { textStreaming: true },
      body: {
        query: 'What is our refund policy?',
        messages: [],
        workspace_id: 'ws-1',
      },
    })
  );
  expect(chatState.updateMessage).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({
      citations: [
        {
          index: 1,
          slug: 'refund-policy',
          version_id: 2,
          last_updated: '2026-05-01T00:00:00.000Z',
          excerpt: 'Enterprise refunds are allowed.',
        },
      ],
    })
  );
  expect(chatState.appendToken).toHaveBeenCalledWith(
    expect.any(String),
    'Enterprise refunds are allowed [1].'
  );
});

it('includes prior user and assistant turns in the chat payload', async () => {
  useChatStore.setState({
    messages: [
      { id: 'u-old', role: 'user', text: 'What is our refund policy?' },
      {
        id: 'a-old',
        role: 'assistant',
        text: 'Enterprise refunds are allowed [1].',
        citations: [],
      },
    ],
    sending: false,
    activeCitation: null,
  });
  const tree = render(
    <ChatScreen navigation={{} as any} route={{ key: 'ChatTab', name: 'ChatTab' }} />
  );

  await act(async () => {
    findTextInputByPlaceholder(tree.root, 'Ask the brain...').props.onChangeText(
      'What about SMB customers?'
    );
  });
  const sendButton = tree.root.findAll((node) => node.props.accessibilityLabel === 'Send')[0]!;
  await act(async () => {
    await sendButton.props.onPress();
  });

  expect(rawApiFetch).toHaveBeenCalledWith(
    '/chat',
    expect.objectContaining({
      method: 'POST',
      body: expect.objectContaining({
        query: 'What about SMB customers?',
        workspace_id: 'ws-1',
        messages: [
          { role: 'user', text: 'What is our refund policy?' },
          { role: 'assistant', text: 'Enterprise refunds are allowed [1].' },
        ],
      }),
      reactNative: { textStreaming: true },
    })
  );
});
