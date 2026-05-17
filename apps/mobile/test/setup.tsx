import React from 'react';
import { createRequire } from 'node:module';
import { vi } from 'vitest';

import * as ReactNativeShim from './react-native';

const { Text, View } = ReactNativeShim;
const nodeRequire = createRequire(import.meta.url);
const reactNativePath = nodeRequire.resolve('react-native');
(nodeRequire.cache as Record<string, NodeJS.Module | undefined>)[reactNativePath] = {
  id: reactNativePath,
  filename: reactNativePath,
  loaded: true,
  exports: ReactNativeShim,
  children: [],
  paths: [],
} as unknown as NodeJS.Module;

vi.mock('react-native-reanimated', () => ({
  default: {
    View,
    createAnimatedComponent: (Component: React.ComponentType<any>) => Component,
  },
  Easing: {
    bezier: () => undefined,
    out: () => undefined,
  },
  useAnimatedStyle: (fn: () => unknown) => fn(),
  useSharedValue: (value: unknown) => ({ value }),
  withTiming: (value: unknown) => value,
}));

vi.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => <View>{children}</View>,
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

vi.mock('expo-linking', () => ({
  createURL: (path = '') => `open42://${path}`,
  getInitialURL: async () => null,
  parse: (url: string) => {
    const parsed = new URL(url.replace('open42://', 'https://open42.local/'));
    return {
      path: parsed.pathname.replace(/^\//, ''),
      queryParams: Object.fromEntries(parsed.searchParams),
    };
  },
}));

vi.mock('expo-clipboard', () => ({
  setStringAsync: vi.fn(async () => undefined),
}));

vi.mock('react-native-markdown-display', () => ({
  default: ({ children }: { children: React.ReactNode }) => <Text>{children}</Text>,
}));

vi.mock('lucide-react-native', () => {
  const Icon = () => <Text>icon</Text>;
  return {
    ArrowUp: Icon,
    Cable: Icon,
    ChevronRight: Icon,
    ChevronLeft: Icon,
    Copy: Icon,
    CreditCard: Icon,
    ExternalLink: Icon,
    Home: Icon,
    KeyRound: Icon,
    Link: Icon,
    LogOut: Icon,
    MessageSquare: Icon,
    PlugZap: Icon,
    RotateCcw: Icon,
    Settings: Icon,
    Sparkles: Icon,
    UserRound: Icon,
    UsersRound: Icon,
    X: Icon,
  };
});

vi.spyOn(console, 'error').mockImplementation(() => undefined);
