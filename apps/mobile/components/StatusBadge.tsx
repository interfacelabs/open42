import { View, type ViewStyle } from 'react-native';

import { colors, radii } from '@/utils/theme';

import { AppText } from './ui/Text';

interface StatusBadgeProps {
  label: string;
  tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'error';
}

export function StatusBadge({ label, tone = 'neutral' }: StatusBadgeProps) {
  return (
    <View style={[badgeBase, badgeTone[tone]]}>
      <AppText
        variant="caption"
        weight="medium"
        tone={tone === 'accent' ? 'accent' : tone === 'error' ? 'error' : 'subtle'}>
        {label}
      </AppText>
    </View>
  );
}

const badgeBase: ViewStyle = {
  alignSelf: 'flex-start',
  borderRadius: radii.input,
  borderWidth: 1,
  paddingHorizontal: 9,
  paddingVertical: 4,
};

const badgeTone: Record<NonNullable<StatusBadgeProps['tone']>, ViewStyle> = {
  neutral: {
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.border,
  },
  accent: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accentSoft,
  },
  success: {
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.border,
  },
  warning: {
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.borderStrong,
  },
  error: {
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.borderStrong,
  },
};
