import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  inserted: null as Record<string, unknown> | null,
  selected: [] as unknown[],
  patches: [] as unknown[],
}));

vi.mock('../db/client.js', () => {
  const column = {};
  return {
    schema: {
      sessions: {
        id: column,
      },
    },
    db: {
      insert: vi.fn(() => ({
        values: vi.fn((record: Record<string, unknown>) => ({
          returning: vi.fn(async () => {
            const session = { id: 'db-session-1', ...record };
            state.inserted = session;
            state.selected = [session];
            return [session];
          }),
        })),
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
            state.patches.push(patch);
            const current = state.selected[0];
            if (current && typeof current === 'object') {
              state.selected = [{ ...current, ...(patch as object) }];
            }
          }),
        })),
      })),
    },
  };
});

const { createSession, invalidateSession, validateSession } = await import('./sessions.js');

describe('session Drizzle adapter', () => {
  beforeEach(() => {
    state.inserted = null;
    state.selected = [];
    state.patches = [];
  });

  it('creates, validates, updates, and invalidates through the default repository', async () => {
    const created = await createSession(
      'user-db',
      { userAgent: 'db-agent', ip: '203.0.113.10' },
      undefined,
      new Date('2026-05-06T10:00:00Z'),
    );

    await expect(
      validateSession(
        created.id,
        { userAgent: 'db-agent', ip: '203.0.113.99' },
        undefined,
        new Date('2026-05-07T10:00:00Z'),
      ),
    ).resolves.toMatchObject({ id: 'db-session-1' });

    await invalidateSession(created.id);

    expect(state.inserted).toMatchObject({ userId: 'user-db' });
    expect(state.patches).toHaveLength(2);
    expect(state.patches[0]).toMatchObject({ expiresAt: new Date('2026-06-06T10:00:00Z') });
    expect(state.patches[1]).toMatchObject({ expiresAt: new Date(0) });
  });
});
