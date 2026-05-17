import { type ReactNode } from 'react';
import { View, type ViewStyle } from 'react-native';

import { colors, radii, shadow } from '@/utils/theme';

interface CardProps {
  children: ReactNode;
  style?: ViewStyle;
}

export function Card({ children, style }: CardProps) {
  return <View style={[cardStyle, style]}>{children}</View>;
}

const cardStyle: ViewStyle = {
  backgroundColor: colors.surface,
  borderColor: colors.border,
  borderRadius: radii.card,
  borderWidth: 1,
  padding: 16,
  ...shadow.card,
};
