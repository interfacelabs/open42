import { forwardRef } from 'react';
import { TextInput, type TextInputProps, type TextStyle, type ViewStyle } from 'react-native';

import { colors, fonts, radii } from '@/utils/theme';

interface TextFieldProps extends TextInputProps {
  error?: boolean;
}

export const TextField = forwardRef<TextInput, TextFieldProps>(
  ({ error, style, ...props }, ref) => (
    <TextInput
      ref={ref}
      placeholderTextColor={colors.textFaint}
      selectionColor={colors.accent}
      style={[inputStyle, error ? errorStyle : null, style]}
      autoCapitalize="none"
      autoCorrect={false}
      {...props}
    />
  )
);

TextField.displayName = 'TextField';

const inputStyle: TextStyle & ViewStyle = {
  backgroundColor: colors.surface,
  borderColor: colors.borderStrong,
  borderRadius: radii.input,
  borderWidth: 1,
  color: colors.textPrimary,
  fontFamily: fonts.sans,
  fontSize: 15,
  minHeight: 48,
  paddingHorizontal: 14,
};

const errorStyle: ViewStyle = {
  borderColor: colors.error,
};
