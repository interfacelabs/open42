import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Transcript } from '@/components/Transcript';
import type { ChatMessage } from '@/components/chat-types';

describe('Transcript', () => {
  it('renders failed assistant turns with a retry button that preserves the message id', () => {
    const onRetry = vi.fn();
    const messages: ChatMessage[] = [
      { id: 'u1', role: 'user', text: 'What is the refund policy?' },
      {
        id: 'a1',
        role: 'assistant',
        text: '',
        error: 'provider_stream_failed',
        retryQuery: 'What is the refund policy?',
      },
    ];

    render(
      <Transcript
        messages={messages}
        thinking={false}
        activeCitationIndex={null}
        onActivateCitation={() => undefined}
        onRetry={onRetry}
      />,
    );

    expect(screen.getByText('The model could not finish that answer.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /retry/i }));

    expect(onRetry).toHaveBeenCalledWith('a1');
  });

  it('does not render retry when the failed turn has no retry query', () => {
    render(
      <Transcript
        messages={[
          {
            id: 'a1',
            role: 'assistant',
            text: '',
            error: 'chat_body_too_large',
          },
        ]}
        thinking={false}
        activeCitationIndex={null}
        onActivateCitation={() => undefined}
        onRetry={() => undefined}
      />,
    );

    expect(screen.getByText('That thread is too large to send.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
  });
});
