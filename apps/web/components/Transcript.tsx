import { memo } from 'react';
import { motion } from 'motion/react';

import type { ChatMessage, Citation } from './chat-types';
import { CitationChip } from './CitationChip';
import { ThinkingDots } from './ThinkingDots';

interface TranscriptProps {
  messages: ChatMessage[];
  thinking: boolean;
  activeCitationIndex: number | null;
  onActivateCitation: (index: number) => void;
}

/**
 * Transcript — calm chat view in the spirit of officehours / Granola.
 *
 * Layout rules:
 *   - User turns: dark `text-primary` bubble, asymmetric radius (sharp
 *     bottom-right corner), right-aligned.
 *   - Assistant turns: plain text, no bubble, left-aligned. Citations are
 *     rendered inline as <CitationChip /> chips.
 *
 * Width is capped by the parent column (max-w-chat → 720px in tokens).
 */
export function Transcript({
  messages,
  thinking,
  activeCitationIndex,
  onActivateCitation,
}: TranscriptProps) {
  return (
    <div className="flex flex-col gap-6">
      {messages.map((message) => (
        <TranscriptRow
          key={message.id}
          message={message}
          activeCitationIndex={activeCitationIndex}
          onActivateCitation={onActivateCitation}
        />
      ))}
      {thinking ? (
        <div className="flex justify-start">
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
      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
        className="flex justify-end"
      >
        <p
          className="max-w-[520px] whitespace-pre-wrap bg-text-primary px-[18px] py-3 text-[14.5px] leading-[1.7] tracking-[-0.006em] text-white"
          style={{ borderRadius: '20px 20px 4px 20px' }}
        >
          {message.text}
        </p>
      </motion.div>
    );
  }

  if (message.role === 'system') {
    return (
      <div className="flex justify-center">
        <p className="font-mono text-[11px] text-text-faint">{message.text}</p>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
      className="flex justify-start"
    >
      <div className="max-w-[600px] whitespace-pre-wrap text-[14.5px] leading-[1.75] tracking-[-0.005em] text-text-body">
        {renderWithCitations(
          message.text,
          message.citations ?? [],
          activeCitationIndex,
          onActivateCitation,
        )}
      </div>
    </motion.div>
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
