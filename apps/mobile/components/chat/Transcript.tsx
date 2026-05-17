import { memo } from 'react';
import { Pressable, View } from 'react-native';
import type { ChatMessage, Citation } from '@open42/shared-types';
import { RotateCcw } from 'lucide-react-native';

import { AppText } from '@/components/ui/Text';
import { humanizeError } from '@/utils/errors';
import { colors } from '@/utils/theme';

import { CitationChip } from './CitationChip';

interface TranscriptProps {
  messages: ChatMessage[];
  thinking: boolean;
  activeCitation: Citation | null;
  onCitation: (citation: Citation) => void;
  onRetry: (messageId: string) => void;
}

export function Transcript({
  messages,
  thinking,
  activeCitation,
  onCitation,
  onRetry,
}: TranscriptProps) {
  return (
    <View className="gap-5">
      {messages.map((message) => (
        <TranscriptRow
          key={message.id}
          message={message}
          activeCitation={activeCitation}
          onCitation={onCitation}
          onRetry={onRetry}
        />
      ))}
      {thinking ? (
        <AppText variant="caption" tone="faint">
          brain · reading sources
        </AppText>
      ) : null}
    </View>
  );
}

const TranscriptRow = memo(function TranscriptRow({
  message,
  activeCitation,
  onCitation,
  onRetry,
}: {
  message: ChatMessage;
  activeCitation: Citation | null;
  onCitation: (citation: Citation) => void;
  onRetry: (messageId: string) => void;
}) {
  if (message.role === 'user') {
    return (
      <View className="items-end">
        <View
          className="max-w-[86%] rounded-[20px] rounded-br-md px-4 py-3"
          style={{ backgroundColor: colors.textPrimary }}>
          <AppText variant="body" style={{ color: colors.surface }}>
            {message.text}
          </AppText>
        </View>
      </View>
    );
  }

  if (message.role === 'system') {
    return (
      <View className="items-center">
        <AppText variant="caption" tone="faint">
          {message.text}
        </AppText>
      </View>
    );
  }

  return (
    <View className="items-start">
      <View className="max-w-[94%]">
        {message.error ? (
          <View className="flex-row items-center gap-2 rounded-full border border-border bg-surface px-3 py-2">
            <AppText variant="caption" tone="subtle">
              {humanizeError(message.error)}
            </AppText>
            {message.retryQuery ? (
              <Pressable
                className="flex-row items-center gap-1"
                onPress={() => onRetry(message.id)}>
                <RotateCcw color={colors.accent} size={12} strokeWidth={1.5} />
                <AppText variant="caption" tone="accent" weight="medium">
                  Retry
                </AppText>
              </Pressable>
            ) : null}
          </View>
        ) : (
          <AppText variant="body" tone="body">
            {renderWithCitations(message.text, message.citations ?? [], activeCitation, onCitation)}
          </AppText>
        )}
      </View>
    </View>
  );
});

function renderWithCitations(
  text: string,
  citations: Citation[],
  activeCitation: Citation | null,
  onCitation: (citation: Citation) => void
) {
  const parts = text.split(/(\[\d+])/g);
  return parts.map((part, index) => {
    const match = part.match(/^\[(\d+)]$/);
    if (!match) return part;
    const citation = citations.find((item) => item.index === Number(match[1]));
    if (!citation) return part;
    return (
      <CitationChip
        key={`${citation.index}-${index}`}
        citation={citation}
        active={activeCitation?.index === citation.index}
        onPress={onCitation}
      />
    );
  });
}
