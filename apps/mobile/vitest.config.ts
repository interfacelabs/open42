import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    dedupe: ['react', 'react-test-renderer'],
    alias: {
      '@': path.resolve(__dirname),
      react: path.resolve(__dirname, 'node_modules/react'),
      'react/jsx-dev-runtime': path.resolve(__dirname, 'node_modules/react/jsx-dev-runtime.js'),
      'react/jsx-runtime': path.resolve(__dirname, 'node_modules/react/jsx-runtime.js'),
      'react-native': path.resolve(__dirname, 'test/react-native.tsx'),
    },
  },
  ssr: {
    noExternal: ['@testing-library/react-native', 'zustand', 'use-sync-external-store', 'swr'],
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['**/*.test.ts', '**/*.test.tsx'],
    setupFiles: ['./test/setup.tsx'],
  },
});
