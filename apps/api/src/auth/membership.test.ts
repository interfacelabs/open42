import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Pure-logic tests for the membership-aware workspace resolver.
 *
 * Mirrors the regression that made this file exist (Codex ship-blocker #1):
 *   User A owns workspace W. User B's `users.currentWorkspaceId` is
 *   somehow set to W (corrupt write, malicious input, future bug). The
 *   *unsafe* path — "look up users.currentWorkspaceId, fetch workspaces by
 *   id" — would return W's gbrain credentials to B.
 *
 *   The new helpers MUST refuse: assertWorkspaceMembership(B, W) throws
 *   `workspace_membership_required` because B has no row in `memberships`
 *   for W. The mocked DB below stores only the legitimate (A, W) row, so
 *   any (B, W) query returns no rows.
 */

interface MembershipRow {
  userId: string;
  workspaceId: string;
  role: 'owner' | 'member';
}

interface WorkspaceRow {
  id: string;
  deletedAt: Date | null;
}

const state = vi.hoisted(() => ({
  memberships: [] as Array<{ userId: string; workspaceId: string; role: 'owner' | 'member' }>,
  workspaces: [] as Array<{ id: string; deletedAt: Date | null }>,
  predicate: null as null | ((row: { membership: MembershipRow; workspace: WorkspaceRow }) => boolean),
  capturedSelection: null as null | 'role' | 'workspaceId',
}));

/**
 * The mock evaluates Drizzle filter predicates by capturing each `eq()` /
 * `and()` / `isNull()` call into a tiny tree, then walking that tree against
 * each (membership, workspace) pair. Drizzle's `eq` is opaque at runtime so
 * we replace it with a tagged shape the mock understands.
 */
type Predicate =
  | { kind: 'eq'; col: string; value: unknown }
  | { kind: 'isNull'; col: string }
  | { kind: 'and'; clauses: Predicate[] };

vi.mock('drizzle-orm', () => ({
  eq: (col: { __col: string }, value: unknown): Predicate => ({ kind: 'eq', col: col.__col, value }),
  and: (...clauses: Predicate[]): Predicate => ({ kind: 'and', clauses }),
  isNull: (col: { __col: string }): Predicate => ({ kind: 'isNull', col: col.__col }),
}));

vi.mock('../db/client.js', () => {
  const col = (name: string) => ({ __col: name });
  return {
    schema: {
      memberships: {
        userId: col('memberships.userId'),
        workspaceId: col('memberships.workspaceId'),
        role: col('memberships.role'),
      },
      workspaces: {
        id: col('workspaces.id'),
        deletedAt: col('workspaces.deletedAt'),
      },
    },
    db: {
      select: vi.fn((selection?: Record<string, { __col: string }>) => {
        // Capture which field is being selected so we can return the right shape.
        if (selection && 'role' in selection) state.capturedSelection = 'role';
        else if (selection && 'workspaceId' in selection) state.capturedSelection = 'workspaceId';
        else state.capturedSelection = null;
        return {
          from: vi.fn(() => ({
            innerJoin: vi.fn((_table: unknown, _joinExpr: unknown) => ({
              where: vi.fn((expr: Predicate) => {
                state.predicate = (row) => evalPredicate(expr, row);
                return {
                  limit: vi.fn(async (_n: number) => {
                    const rows = state.memberships
                      .map((m) => {
                        const ws = state.workspaces.find((w) => w.id === m.workspaceId);
                        if (!ws) return null;
                        return { membership: m, workspace: ws };
                      })
                      .filter((r): r is { membership: MembershipRow; workspace: WorkspaceRow } => r !== null)
                      .filter((row) => state.predicate!(row));
                    if (rows.length === 0) return [];
                    const first = rows[0]!;
                    if (state.capturedSelection === 'role') {
                      return [{ role: first.membership.role }];
                    }
                    if (state.capturedSelection === 'workspaceId') {
                      return [{ workspaceId: first.membership.workspaceId }];
                    }
                    return [first];
                  }),
                };
              }),
            })),
          })),
        };
      }),
    },
  };
});

function evalPredicate(
  pred: Predicate,
  row: { membership: MembershipRow; workspace: WorkspaceRow },
): boolean {
  if (pred.kind === 'and') return pred.clauses.every((c) => evalPredicate(c, row));
  if (pred.kind === 'isNull') {
    if (pred.col === 'workspaces.deletedAt') return row.workspace.deletedAt === null;
    return false;
  }
  // eq
  switch (pred.col) {
    case 'memberships.userId':
      return row.membership.userId === pred.value;
    case 'memberships.workspaceId':
      return row.membership.workspaceId === pred.value;
    case 'memberships.role':
      return row.membership.role === pred.value;
    case 'workspaces.id':
      return row.workspace.id === pred.value;
    case 'workspaces.deletedAt':
      return row.workspace.deletedAt === pred.value;
    default:
      return false;
  }
}

const { resolveOwnerWorkspaceId, assertWorkspaceMembership } = await import('./membership.js');

describe('membership-gated workspace resolution', () => {
  beforeEach(() => {
    state.memberships = [];
    state.workspaces = [];
    state.predicate = null;
    state.capturedSelection = null;
  });

  describe('resolveOwnerWorkspaceId', () => {
    it('returns the workspaceId of the owner row', async () => {
      state.workspaces = [{ id: 'ws-A', deletedAt: null }];
      state.memberships = [{ userId: 'user-A', workspaceId: 'ws-A', role: 'owner' }];

      await expect(resolveOwnerWorkspaceId('user-A')).resolves.toBe('ws-A');
    });

    it('returns null when the user owns no workspace', async () => {
      state.workspaces = [{ id: 'ws-A', deletedAt: null }];
      state.memberships = [{ userId: 'user-A', workspaceId: 'ws-A', role: 'member' }];

      await expect(resolveOwnerWorkspaceId('user-A')).resolves.toBeNull();
    });

    it('ignores soft-deleted workspaces', async () => {
      state.workspaces = [{ id: 'ws-A', deletedAt: new Date('2026-05-01T00:00:00Z') }];
      state.memberships = [{ userId: 'user-A', workspaceId: 'ws-A', role: 'owner' }];

      await expect(resolveOwnerWorkspaceId('user-A')).resolves.toBeNull();
    });
  });

  describe('assertWorkspaceMembership', () => {
    it('returns the role when membership exists', async () => {
      state.workspaces = [{ id: 'ws-A', deletedAt: null }];
      state.memberships = [{ userId: 'user-A', workspaceId: 'ws-A', role: 'owner' }];

      await expect(assertWorkspaceMembership('user-A', 'ws-A')).resolves.toEqual({
        role: 'owner',
      });
    });

    it('throws workspace_membership_required for a non-member', async () => {
      // The regression: user B has no membership for workspace ws-A even
      // though their `users.currentWorkspaceId` was somehow set to ws-A.
      // The helper must refuse — the membership row is the only auth claim.
      state.workspaces = [{ id: 'ws-A', deletedAt: null }];
      state.memberships = [{ userId: 'user-A', workspaceId: 'ws-A', role: 'owner' }];

      await expect(assertWorkspaceMembership('user-B', 'ws-A')).rejects.toThrow(
        'workspace_membership_required',
      );
    });

    it('throws when the workspace is soft-deleted', async () => {
      state.workspaces = [{ id: 'ws-A', deletedAt: new Date('2026-05-01T00:00:00Z') }];
      state.memberships = [{ userId: 'user-A', workspaceId: 'ws-A', role: 'owner' }];

      await expect(assertWorkspaceMembership('user-A', 'ws-A')).rejects.toThrow(
        'workspace_membership_required',
      );
    });

    it('throws when the user is a member of a different workspace', async () => {
      state.workspaces = [
        { id: 'ws-A', deletedAt: null },
        { id: 'ws-B', deletedAt: null },
      ];
      state.memberships = [
        { userId: 'user-A', workspaceId: 'ws-A', role: 'owner' },
        { userId: 'user-B', workspaceId: 'ws-B', role: 'owner' },
      ];

      await expect(assertWorkspaceMembership('user-B', 'ws-A')).rejects.toThrow(
        'workspace_membership_required',
      );
    });
  });
});
