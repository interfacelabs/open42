import { forwardRef, type ReactNode } from 'react';
import {
  Text as NativeText,
  type TextProps as NativeTextProps,
  type TextStyle,
} from 'react-native';

import { colors, fonts } from '@/utils/theme';

type TextVariant =
  | 'eyebrow'
  | 'display'
  | 'title'
  | 'section'
  | 'body'
  | 'muted'
  | 'caption'
  | 'mono';

interface TextProps extends NativeTextProps {
  variant?: TextVariant;
  tone?: 'primary' | 'body' | 'subtle' | 'faint' | 'accent' | 'error' | 'success' | 'warning';
  weight?: 'regular' | 'medium' | 'semi';
  children: ReactNode;
}

export const AppText = forwardRef<NativeText, TextProps>(
  ({ variant = 'body', tone, weight, style, children, ...props }, ref) => {
    const textStyle = [
      variantStyles[variant],
      colorStyle(tone ?? defaultTone(variant)),
      fontStyle(variant, weight),
      style,
    ];
    return (
      <NativeText ref={ref} style={textStyle} {...props}>
        {children}
      </NativeText>
    );
  }
);

AppText.displayName = 'AppText';

const variantStyles: Record<TextVariant, TextStyle> = {
  eyebrow: {
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0,
    textTransform: 'uppercase',
  },
  display: {
    fontSize: 34,
    lineHeight: 38,
    letterSpacing: 0,
  },
  title: {
    fontSize: 26,
    lineHeight: 31,
    letterSpacing: 0,
  },
  section: {
    fontSize: 18,
    lineHeight: 23,
    letterSpacing: 0,
  },
  body: {
    fontSize: 15,
    lineHeight: 23,
    letterSpacing: 0,
  },
  muted: {
    fontSize: 14,
    lineHeight: 21,
    letterSpacing: 0,
  },
  caption: {
    fontSize: 12,
    lineHeight: 17,
    letterSpacing: 0,
  },
  mono: {
    fontSize: 11,
    lineHeight: 16,
    letterSpacing: 0,
  },
};

function defaultTone(variant: TextVariant): NonNullable<TextProps['tone']> {
  if (variant === 'display' || variant === 'title' || variant === 'section') return 'primary';
  if (variant === 'caption' || variant === 'eyebrow' || variant === 'mono') return 'subtle';
  return 'body';
}

function colorStyle(tone: NonNullable<TextProps['tone']>): TextStyle {
  switch (tone) {
    case 'primary':
      return { color: colors.textPrimary };
    case 'body':
      return { color: colors.textBody };
    case 'subtle':
      return { color: colors.textSubtle };
    case 'faint':
      return { color: colors.textFaint };
    case 'accent':
      return { color: colors.accent };
    case 'error':
      return { color: colors.error };
    case 'success':
      return { color: colors.success };
    case 'warning':
      return { color: colors.warning };
  }
}

function fontStyle(variant: TextVariant, weight?: TextProps['weight']): TextStyle {
  if (variant === 'mono') {
    return { fontFamily: weight === 'medium' ? fonts.monoMedium : fonts.mono };
  }
  if (weight === 'semi') return { fontFamily: fonts.sansSemi };
  if (weight === 'medium') return { fontFamily: fonts.sansMedium };
  if (variant === 'display' || variant === 'title' || variant === 'section') {
    return { fontFamily: fonts.sansMedium };
  }
  return { fontFamily: fonts.sans };
}
