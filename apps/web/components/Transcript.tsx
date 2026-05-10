import { memo } from 'react';

import type { ChatMessage, Citation } from './chat-types';
import { CitationChip } from './CitationChip';
import { ThinkingDots } from './ThinkingDots';

interface TranscriptProps {
  messages: ChatMessage[];
  thinking: boolean;
  activeCitationIndex: number | null;
  onActivateCitation: (index: number) => void;
}

export function Transcript({
  messages,
  thinking,
  activeCitationIndex,
  onActivateCitation,
}: TranscriptProps) {
  return (
    <div className="space-y-8">
      {messages.map((message) => (
        <TranscriptRow
          key={message.id}
          message={message}
          activeCitationIndex={activeCitationIndex}
          onActivateCitation={onActivateCitation}
        />
      ))}
      {thinking ? (
        <div className="max-w-chat text-sm text-text-subtle">
          <ThinkingDots />
        </div>
      ) : null}
    </div>
  );
}

const TranscriptRow = memo(function TranscriptRow({
  message,
  activeCitationIndex,
  onActivateCitation,
}: {
  message: ChatMessage;
  activeCitationIndex: number | null;
  onActivateCitation: (index: number) => void;
}) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <p className="max-w-[520px] rounded-2xl border border-border bg-muted px-4 py-3 text-sm leading-body text-text-primary">
          {message.text}
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-chat text-base leading-body text-text-body">
      {renderWithCitations(
        message.text,
        message.citations ?? [],
        activeCitationIndex,
        onActivateCitation,
      )}
    </div>
  );
});

function renderWithCitations(
  text: string,
  citations: Citation[],
  activeCitationIndex: number | null,
  onActivateCitation: (index: number) => void,
) {
  const parts = text.split(/(\[\d+])/g);
  return parts.map((part, index) => {
    const match = part.match(/^\[(\d+)]$/);
    if (!match) return <span key={`${part}-${index}`}>{part}</span>;
    const citation = citations.find(
      (item) => item.index === Number(match[1]),
    );
    return citation ? (
      <CitationChip
        key={`${part}-${index}`}
        citation={citation}
        active={activeCitationIndex === citation.index}
        onActivate={onActivateCitation}
      />
    ) : (
      <span key={`${part}-${index}`}>{part}</span>
    );
  });
}
