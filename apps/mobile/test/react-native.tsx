import React from 'react';

type Props = Record<string, any> & { children?: React.ReactNode };

function host(name: string) {
  const Component = React.forwardRef<any, Props>(({ children, ...props }, ref) =>
    React.createElement(name, { ...props, ref }, children)
  );
  Component.displayName = name;
  return Component;
}

export const View = host('View');
export const Text = host('Text');
export const Pressable = host('Pressable');
export const ScrollView = host('ScrollView');
export const KeyboardAvoidingView = host('KeyboardAvoidingView');
export const RefreshControl = host('RefreshControl');
export const ActivityIndicator = host('ActivityIndicator');

export const TextInput = React.forwardRef<any, Props>((props, ref) =>
  React.createElement('TextInput', { ...props, ref })
);
TextInput.displayName = 'TextInput';

export function Modal({ visible, children }: Props) {
  return visible ? <View>{children}</View> : null;
}

export const Platform = {
  OS: 'ios',
  select: (options: Record<string, any>) => options.ios ?? options.default,
};

export const Share = {
  sharedAction: 'sharedAction',
  dismissedAction: 'dismissedAction',
  share: async () => ({ action: 'sharedAction' }),
};

export const Linking = {
  openURL: async () => undefined,
};

export const StyleSheet = {
  create: <T extends Record<string, unknown>>(styles: T) => styles,
  flatten: (style: unknown) => style,
  absoluteFillObject: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
};
