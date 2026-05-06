import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: [
        'src/auth/*.ts',
        'src/connectors/**/*.ts',
        'src/gbrain/client.ts',
        'src/skills/**/*.ts',
      ],
      exclude: ['src/**/*.test.ts', 'src/connectors/interface.ts'],
      thresholds: {
        lines: 100,
      },
    },
  },
});
