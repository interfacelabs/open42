import type { Citation } from '@open42/shared-types';

import { AppText } from '@/components/ui/Text';
import { colors } from '@/utils/theme';

interface CitationChipProps {
  citation: Citation;
  active?: boolean;
  onPress: (citation: Citation) => void;
}

export function CitationChip({ citation, active, onPress }: CitationChipProps) {
  return (
    <AppText
      variant="caption"
      weight="medium"
      tone="accent"
      onPress={() => onPress(citation)}
      style={{
        backgroundColor: active ? colors.accentSoft : colors.surfaceMuted,
        borderRadius: 8,
        overflow: 'hidden',
        paddingHorizontal: 5,
        paddingVertical: 2,
      }}>
      [{citation.index}]
    </AppText>
  );
}
