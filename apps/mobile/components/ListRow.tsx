import { memo, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';

import { colors } from '@/utils/theme';

import { AppText } from './ui/Text';

interface ListRowProps {
  title: string;
  subtitle?: string;
  meta?: string;
  icon?: ReactNode;
  onPress?: () => void;
  right?: ReactNode;
}

function ListRowComponent({ title, subtitle, meta, icon, onPress, right }: ListRowProps) {
  const content = (
    <View className="min-h-[58px] flex-row items-center gap-3 border-b border-border py-3">
      {icon ? (
        <View className="h-8 w-8 items-center justify-center rounded-full bg-surface-muted">
          {icon}
        </View>
      ) : null}
      <View className="min-w-0 flex-1">
        <AppText variant="body" weight="medium" numberOfLines={1}>
          {title}
        </AppText>
        {subtitle ? (
          <AppText variant="caption" tone="subtle" numberOfLines={2} style={{ marginTop: 2 }}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {meta ? (
        <AppText variant="mono" tone="faint">
          {meta}
        </AppText>
      ) : null}
      {right ??
        (onPress ? <ChevronRight color={colors.textFaint} size={17} strokeWidth={1.5} /> : null)}
    </View>
  );

  if (!onPress) return content;
  return (
    <Pressable accessibilityRole="button" onPress={onPress}>
      {content}
    </Pressable>
  );
}

export const ListRow = memo(ListRowComponent);
ListRow.displayName = 'ListRow';
