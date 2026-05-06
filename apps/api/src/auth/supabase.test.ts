import { describe, expect, it, vi } from 'vitest';

import type { SupabaseAuthClient } from './supabase.js';
import { createSupabaseAuthClient, sendSupabaseMagicLink, verifySupabaseIdentity } from './supabase.js';

describe('supabase auth helpers', () => {
  it('sends a normalized Supabase magic link with redirect and TTL', async () => {
    const signInWithOtp = vi.fn(async () => ({ error: null }));
    const result = await sendSupabaseMagicLink({
      email: ' User@Example.COM ',
      redirectTo: 'http://localhost:3000/auth/verify',
      env: { MAGIC_LINK_TTL_MINUTES: '10' },
      now: new Date('2026-05-06T10:00:00Z'),
      client: client({ signInWithOtp }),
    });

    expect(signInWithOtp).toHaveBeenCalledWith({
      email: 'user@example.com',
      options: {
        emailRedirectTo: 'http://localhost:3000/auth/verify',
        shouldCreateUser: true,
      },
    });
    expect(result).toEqual({
      email: 'user@example.com',
      expiresAt: new Date('2026-05-06T10:10:00Z'),
    });
  });

  it('uses process env and default TTL when no helper env is passed', async () => {
    const previous = process.env.MAGIC_LINK_TTL_MINUTES;
    delete process.env.MAGIC_LINK_TTL_MINUTES;
    const result = await sendSupabaseMagicLink({
      email: 'user@example.com',
      redirectTo: 'http://localhost:3000/auth/verify',
      now: new Date('2026-05-06T10:00:00Z'),
      client: client({ signInWithOtp: vi.fn(async () => ({ error: null })) }),
    });

    expect(result.expiresAt).toEqual(new Date('2026-05-06T10:15:00Z'));
    if (previous === undefined) {
      delete process.env.MAGIC_LINK_TTL_MINUTES;
    } else {
      process.env.MAGIC_LINK_TTL_MINUTES = previous;
    }
  });

  it('rejects invalid email addresses before calling Supabase', async () => {
    const signInWithOtp = vi.fn();

    await expect(
      sendSupabaseMagicLink({
        email: 'bad',
        redirectTo: 'http://localhost:3000/auth/verify',
        client: client({ signInWithOtp }),
      }),
    ).rejects.toThrow('email_invalid');
    expect(signInWithOtp).not.toHaveBeenCalled();
  });

  it('verifies access-token and token-hash identities', async () => {
    const auth = client({
      getUser: vi.fn(async () => ({
        data: { user: { id: 'supabase-user-1', email: 'User@Example.com' } },
        error: null,
      })),
      verifyOtp: vi.fn(async () => ({
        data: { user: { id: 'supabase-user-2', email: 'Second@Example.com' } },
        error: null,
      })),
    });

    await expect(verifySupabaseIdentity({ accessToken: 'jwt', client: auth })).resolves.toEqual({
      supabaseUserId: 'supabase-user-1',
      email: 'user@example.com',
    });
    await expect(
      verifySupabaseIdentity({ tokenHash: 'hash', type: 'magiclink', client: auth }),
    ).resolves.toEqual({
      supabaseUserId: 'supabase-user-2',
      email: 'second@example.com',
    });
  });

  it('surfaces Supabase verification failures and missing input', async () => {
    await expect(verifySupabaseIdentity({ client: client({}) })).rejects.toThrow(
      'supabase_verify_input_required',
    );
    await expect(
      verifySupabaseIdentity({ tokenHash: 'hash', type: 'unexpected', client: client({}) }),
    ).rejects.toThrow('supabase_verify_input_required');
    await expect(
      verifySupabaseIdentity({
        accessToken: 'jwt',
        client: client({
          getUser: vi.fn(async () => ({
            data: { user: null },
            error: { message: 'invalid token' },
          })),
        }),
      }),
    ).rejects.toThrow('supabase_verify_failed:invalid token');
  });

  it('verifies email token payloads and reports users without email', async () => {
    const verifyOtp = vi.fn(async () => ({
      data: { user: { id: 'supabase-user-3', email: 'EmailToken@Example.com' } },
      error: null,
    }));

    await expect(
      verifySupabaseIdentity({
        email: 'EmailToken@Example.com',
        token: '123456',
        type: 'magiclink',
        client: client({ verifyOtp }),
      }),
    ).resolves.toEqual({
      supabaseUserId: 'supabase-user-3',
      email: 'emailtoken@example.com',
    });
    expect(verifyOtp).toHaveBeenCalledWith({
      email: 'emailtoken@example.com',
      token: '123456',
      type: 'magiclink',
    });

    await expect(
      verifySupabaseIdentity({
        accessToken: 'jwt',
        client: client({
          getUser: vi.fn(async () => ({
            data: { user: { id: 'supabase-user-no-email' } },
            error: null,
          })),
        }),
      }),
    ).rejects.toThrow('supabase_user_missing_email');
  });

  it('surfaces Supabase send failures and missing environment', async () => {
    await expect(
      sendSupabaseMagicLink({
        email: 'user@example.com',
        redirectTo: 'http://localhost:3000/auth/verify',
        client: client({
          signInWithOtp: vi.fn(async () => ({ error: { message: 'smtp disabled' } })),
        }),
      }),
    ).rejects.toThrow('supabase_magic_link_failed:smtp disabled');

    expect(() =>
      createSupabaseAuthClient({
        SUPABASE_URL: 'https://your-project.supabase.co',
        SUPABASE_ANON_KEY: 'your-anon-key',
      }),
    ).toThrow('SUPABASE_URL is required');
    expect(() =>
      createSupabaseAuthClient({
        SUPABASE_URL: 'https://project.supabase.co',
        SUPABASE_ANON_KEY: 'anon-key',
      }),
    ).not.toThrow();
  });
});

function client(auth: Partial<SupabaseAuthClient['auth']>): SupabaseAuthClient {
  return {
    auth: {
      signInWithOtp: async () => ({ error: null }),
      verifyOtp: async () => ({ data: { user: null }, error: null }),
      getUser: async () => ({ data: { user: null }, error: null }),
      ...auth,
    },
  };
}
