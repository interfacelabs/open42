import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  generateInviteLink: vi.fn(),
  sendEmail: vi.fn(),
}));

vi.mock('../auth/supabase.js', () => ({
  generateInviteLink: mocks.generateInviteLink,
}));

vi.mock('../integrations/resend.js', () => ({
  sendEmail: mocks.sendEmail,
}));

import { sendInvitesForWorkspace, type InviteSendDeps } from './send-invites.js';

function makeUpsert(returns: {
  invites: Array<{ id: string; email: string; role: 'admin' | 'member'; status: 'pending'; createdAt: Date }>;
  failed: Array<{ email: string; reason: string }>;
}) {
  return vi.fn(async () => ({ invites: returns.invites, failed: [...returns.failed] }));
}

const baseInput = {
  workspaceId: 'ws-1',
  workspaceName: 'Speedrun Labs',
  inviterUserId: 'user-1',
  inviterEmail: 'owner@example.com',
  role: 'member' as const,
  webBaseUrl: 'https://app.open42.test',
};

describe('sendInvitesForWorkspace', () => {
  beforeEach(() => {
    mocks.generateInviteLink.mockReset();
    mocks.sendEmail.mockReset();
  });

  it('upserts a pending invite for each email and sends the email', async () => {
    const upsert = makeUpsert({
      invites: [
        { id: 'inv-1', email: 'a@example.com', role: 'member', status: 'pending', createdAt: new Date() },
        { id: 'inv-2', email: 'b@example.com', role: 'member', status: 'pending', createdAt: new Date() },
      ],
      failed: [],
    });
    mocks.generateInviteLink.mockResolvedValue({
      actionLink: 'https://supabase.example/verify?token=abc',
      expiresAt: new Date(),
    });
    mocks.sendEmail.mockResolvedValue({ ok: true });

    const result = await sendInvitesForWorkspace(
      { ...baseInput, emails: ['a@example.com', 'b@example.com'] },
      { upsertInvitesForWorkspace: upsert } satisfies InviteSendDeps,
    );

    expect(result.sent).toBe(2);
    expect(result.failed).toEqual([]);
    expect(result.invites).toHaveLength(2);
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(mocks.generateInviteLink).toHaveBeenCalledTimes(2);
    expect(mocks.sendEmail).toHaveBeenCalledTimes(2);
    expect(mocks.generateInviteLink).toHaveBeenCalledWith({
      email: 'a@example.com',
      redirectTo: 'https://app.open42.test/auth/invite/accept?invite_id=inv-1',
    });
  });

  it('returns failed[] for already_member emails without sending', async () => {
    const upsert = makeUpsert({
      invites: [
        { id: 'inv-1', email: 'a@example.com', role: 'member', status: 'pending', createdAt: new Date() },
      ],
      failed: [{ email: 'member@example.com', reason: 'already_member' }],
    });
    mocks.generateInviteLink.mockResolvedValue({
      actionLink: 'https://supabase.example/verify?token=abc',
      expiresAt: new Date(),
    });
    mocks.sendEmail.mockResolvedValue({ ok: true });

    const result = await sendInvitesForWorkspace(
      { ...baseInput, emails: ['a@example.com', 'member@example.com'] },
      { upsertInvitesForWorkspace: upsert },
    );

    expect(result.sent).toBe(1);
    expect(result.failed).toEqual([{ email: 'member@example.com', reason: 'already_member' }]);
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
  });

  it('returns failed[] for cannot_invite_self', async () => {
    const upsert = makeUpsert({
      invites: [
        { id: 'inv-1', email: 'a@example.com', role: 'member', status: 'pending', createdAt: new Date() },
      ],
      failed: [{ email: 'owner@example.com', reason: 'cannot_invite_self' }],
    });
    mocks.generateInviteLink.mockResolvedValue({
      actionLink: 'https://supabase.example/verify?token=abc',
      expiresAt: new Date(),
    });
    mocks.sendEmail.mockResolvedValue({ ok: true });

    const result = await sendInvitesForWorkspace(
      { ...baseInput, emails: ['a@example.com', 'owner@example.com'] },
      { upsertInvitesForWorkspace: upsert },
    );

    expect(result.sent).toBe(1);
    expect(result.failed).toEqual([{ email: 'owner@example.com', reason: 'cannot_invite_self' }]);
  });

  it('counts per-email send failures into failed[]', async () => {
    const upsert = makeUpsert({
      invites: [
        { id: 'inv-1', email: 'a@example.com', role: 'member', status: 'pending', createdAt: new Date() },
        { id: 'inv-2', email: 'b@example.com', role: 'member', status: 'pending', createdAt: new Date() },
      ],
      failed: [],
    });
    mocks.generateInviteLink.mockResolvedValue({
      actionLink: 'https://supabase.example/verify?token=abc',
      expiresAt: new Date(),
    });
    mocks.sendEmail
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, error: 'rate_limited' });

    const result = await sendInvitesForWorkspace(
      { ...baseInput, emails: ['a@example.com', 'b@example.com'] },
      { upsertInvitesForWorkspace: upsert },
    );

    expect(result.sent).toBe(1);
    expect(result.failed).toEqual([{ email: 'b@example.com', reason: 'email_send_failed' }]);
  });

  it('counts invite_link_failed when generateInviteLink throws', async () => {
    const upsert = makeUpsert({
      invites: [
        { id: 'inv-1', email: 'a@example.com', role: 'member', status: 'pending', createdAt: new Date() },
      ],
      failed: [],
    });
    mocks.generateInviteLink.mockRejectedValue(new Error('supabase_down'));
    mocks.sendEmail.mockResolvedValue({ ok: true });

    const result = await sendInvitesForWorkspace(
      { ...baseInput, emails: ['a@example.com'] },
      { upsertInvitesForWorkspace: upsert },
    );

    expect(result.sent).toBe(0);
    expect(result.failed).toEqual([{ email: 'a@example.com', reason: 'invite_link_failed' }]);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it('throws when emails.length is 0', async () => {
    const upsert = makeUpsert({ invites: [], failed: [] });
    await expect(
      sendInvitesForWorkspace({ ...baseInput, emails: [] }, { upsertInvitesForWorkspace: upsert }),
    ).rejects.toThrow(/invite_emails_required/);
  });

  it('throws when emails.length > 10', async () => {
    const upsert = makeUpsert({ invites: [], failed: [] });
    const too_many = Array.from({ length: 11 }, (_, i) => `u${i}@example.com`);
    await expect(
      sendInvitesForWorkspace({ ...baseInput, emails: too_many }, { upsertInvitesForWorkspace: upsert }),
    ).rejects.toThrow(/invite_emails_too_many/);
  });

  it('throws when an email is malformed', async () => {
    const upsert = makeUpsert({ invites: [], failed: [] });
    await expect(
      sendInvitesForWorkspace(
        { ...baseInput, emails: ['not-an-email'] },
        { upsertInvitesForWorkspace: upsert },
      ),
    ).rejects.toThrow(/invite_emails_invalid/);
  });
});
