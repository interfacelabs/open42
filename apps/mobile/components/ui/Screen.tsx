import { useEffect, type ReactElement, type ReactNode } from 'react';
import { ScrollView, View, type RefreshControlProps, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { colors } from '@/utils/theme';

interface ScreenProps {
  children: ReactNode;
  scroll?: boolean;
  padded?: boolean;
  footer?: ReactNode;
  refreshControl?: ReactNode;
}

export function Screen({
  children,
  scroll = true,
  padded = true,
  footer,
  refreshControl,
}: ScreenProps) {
  const insets = useSafeAreaInsets();
  const entry = useSharedValue(0);
  const transitionStyle = useAnimatedStyle(() => ({
    opacity: entry.value,
    transform: [{ translateY: (1 - entry.value) * 4 }],
  }));
  const contentStyle = [
    baseContent,
    padded ? paddedContent : null,
    { paddingTop: insets.top + 14 },
  ];

  useEffect(() => {
    entry.value = withTiming(1, { duration: 160 });
  }, [entry]);

  if (!scroll) {
    return (
      <View style={rootStyle}>
        <Animated.View style={[contentStyle, { flex: 1 }, transitionStyle]}>
          {children}
        </Animated.View>
        {footer ? (
          <View style={[footerStyle, { paddingBottom: insets.bottom + 12 }]}>{footer}</View>
        ) : null}
      </View>
    );
  }

  return (
    <View style={rootStyle}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        refreshControl={refreshControl as ReactElement<RefreshControlProps> | undefined}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={contentStyle}>
        <Animated.View style={transitionStyle}>{children}</Animated.View>
      </ScrollView>
      {footer ? (
        <View style={[footerStyle, { paddingBottom: insets.bottom + 12 }]}>{footer}</View>
      ) : null}
    </View>
  );
}

const rootStyle: ViewStyle = {
  backgroundColor: colors.bg,
  flex: 1,
};

const baseContent: ViewStyle = {
  paddingBottom: 28,
};

const paddedContent: ViewStyle = {
  paddingHorizontal: 20,
};

const footerStyle: ViewStyle = {
  backgroundColor: colors.surface,
  borderTopColor: colors.border,
  borderTopWidth: 1,
  paddingHorizontal: 20,
  paddingTop: 12,
};
