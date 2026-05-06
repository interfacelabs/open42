import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  inserted: [] as unknown[],
  selected: [] as unknown[],
  updated: [] as unknown[],
}));

vi.mock('../db/client.js', () => {
  const column = {};
  return {
    schema: {
      magicLinks: {
        token: column,
        usedAt: column,
      },
    },
    db: {
      insert: vi.fn(() => ({
        values: vi.fn(async (record: unknown) => {
          state.inserted.push(record);
        }),
      })),
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(async () => state.selected),
          })),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn((patch: unknown) => ({
          where: vi.fn(async () => {
            state.updated.push(patch);
          }),
        })),
      })),
    },
  };
});

const { consumeMagicLink, createMagicLink } = await import('./magic-link.js');

describe('magic link Drizzle adapter', () => {
  beforeEach(() => {
    state.inserted.length = 0;
    state.selected.length = 0;
    state.updated.length = 0;
  });

  it('persists, finds, and marks links used through the default repository', async () => {
    const now = new Date('2026-05-06T10:00:00Z');
    const link = await createMagicLink('db@example.com', undefined, now);
    state.selected.push(link);

    await expect(consumeMagicLink(link.token, undefined, now)).resolves.toMatchObject({
      email: 'db@example.com',
      usedAt: now,
    });
    expect(state.inserted).toEqual([link]);
    expect(state.updated).toEqual([{ usedAt: now }]);
  });
});
