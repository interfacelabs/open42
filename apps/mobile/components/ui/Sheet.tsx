import { useEffect, type ReactNode } from 'react';
import { Modal, Pressable, View, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';

import { colors, radii, shadow } from '@/utils/theme';

import { AppText } from './Text';

interface SheetProps {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

export function Sheet({ visible, title, onClose, children, footer }: SheetProps) {
  const insets = useSafeAreaInsets();
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withTiming(visible ? 1 : 0, { duration: visible ? 220 : 140 });
  }, [progress, visible]);

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: progress.value * 0.28,
  }));
  const sheetStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * 18 }],
  }));

  return (
    <Modal animationType="none" transparent visible={visible} onRequestClose={onClose}>
      <View style={modalStyle}>
        <Animated.View style={[backdropBase, backdropStyle]} />
        <Pressable accessibilityRole="button" style={backdropPressable} onPress={onClose} />
        <Animated.View style={[containerStyle, { paddingBottom: insets.bottom + 16 }, sheetStyle]}>
          <View style={headerStyle}>
            <AppText variant="section" weight="medium">
              {title}
            </AppText>
            <Pressable accessibilityLabel="Close" onPress={onClose} hitSlop={12}>
              <X color={colors.textSubtle} size={18} strokeWidth={1.5} />
            </Pressable>
          </View>
          <View style={contentStyle}>{children}</View>
          {footer ? <View style={footerStyle}>{footer}</View> : null}
        </Animated.View>
      </View>
    </Modal>
  );
}

const modalStyle: ViewStyle = {
  flex: 1,
  justifyContent: 'flex-end',
};

const StyleSheetAbsolute: ViewStyle = {
  bottom: 0,
  left: 0,
  position: 'absolute',
  right: 0,
  top: 0,
};

const backdropBase: ViewStyle = {
  ...StyleSheetAbsolute,
  backgroundColor: colors.textPrimary,
};

const backdropPressable: ViewStyle = {
  ...StyleSheetAbsolute,
};

const containerStyle: ViewStyle = {
  backgroundColor: colors.surface,
  borderTopLeftRadius: radii.sheet,
  borderTopRightRadius: radii.sheet,
  maxHeight: '88%',
  paddingHorizontal: 20,
  paddingTop: 18,
  ...shadow.card,
};

const headerStyle: ViewStyle = {
  alignItems: 'center',
  flexDirection: 'row',
  justifyContent: 'space-between',
};

const contentStyle: ViewStyle = {
  paddingTop: 18,
};

const footerStyle: ViewStyle = {
  borderTopColor: colors.border,
  borderTopWidth: 1,
  marginTop: 18,
  paddingTop: 14,
};
