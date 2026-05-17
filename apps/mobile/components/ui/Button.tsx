import { forwardRef, type ReactNode } from 'react';
import { Pressable, type PressableProps, type View, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { colors, radii, shadow } from '@/utils/theme';

import { AppText } from './Text';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface ButtonProps extends Omit<PressableProps, 'children' | 'style'> {
  children: ReactNode;
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  style?: ViewStyle;
  icon?: ReactNode;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export const Button = forwardRef<View, ButtonProps>(
  (
    {
      children,
      variant = 'primary',
      size = 'md',
      loading = false,
      disabled,
      icon,
      style,
      onPressIn,
      onPressOut,
      ...props
    },
    ref
  ) => {
    const pressed = useSharedValue(0);
    const animatedStyle = useAnimatedStyle(() => ({
      transform: [{ translateY: pressed.value }],
    }));
    const isDisabled = disabled || loading;

    return (
      <AnimatedPressable
        ref={ref}
        accessibilityRole="button"
        disabled={isDisabled}
        onPressIn={(event) => {
          pressed.value = withTiming(1, { duration: 80 });
          onPressIn?.(event);
        }}
        onPressOut={(event) => {
          pressed.value = withTiming(0, { duration: 120 });
          onPressOut?.(event);
        }}
        style={[
          baseStyle,
          sizeStyles[size],
          variantStyles[variant],
          isDisabled ? disabledStyle : null,
          animatedStyle,
          style,
        ]}
        {...props}>
        {loading ? null : icon}
        <AppText
          variant="body"
          weight="medium"
          tone={variant === 'primary' || variant === 'danger' ? 'primary' : 'body'}
          style={[
            labelStyle,
            variant === 'primary' || variant === 'danger' ? { color: colors.surface } : null,
          ]}>
          {children}
        </AppText>
      </AnimatedPressable>
    );
  }
);

Button.displayName = 'Button';

const baseStyle: ViewStyle = {
  alignItems: 'center',
  borderRadius: radii.button,
  flexDirection: 'row',
  gap: 8,
  justifyContent: 'center',
};

const sizeStyles: Record<NonNullable<ButtonProps['size']>, ViewStyle> = {
  sm: { minHeight: 38, paddingHorizontal: 14 },
  md: { minHeight: 46, paddingHorizontal: 18 },
  lg: { minHeight: 52, paddingHorizontal: 22 },
};

const variantStyles: Record<ButtonVariant, ViewStyle> = {
  primary: {
    backgroundColor: colors.textPrimary,
    ...shadow.button,
  },
  secondary: {
    backgroundColor: colors.surface,
    borderColor: colors.borderStrong,
    borderWidth: 1,
    ...shadow.card,
  },
  ghost: {
    backgroundColor: colors.surfaceMuted,
  },
  danger: {
    backgroundColor: colors.error,
  },
};

const disabledStyle: ViewStyle = {
  opacity: 0.5,
};

const labelStyle = {
  textAlign: 'center' as const,
};
