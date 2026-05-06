import { createClient } from '@supabase/supabase-js';

const DEFAULT_MAGIC_LINK_TTL_MINUTES = 15;

type SupabaseOtpType = 'signup' | 'magiclink' | 'recovery' | 'invite' | 'email';

interface SupabaseAuthError {
  message: string;
}

interface SupabaseUser {
  id: string;
  email?: string;
}

export interface SupabaseIdentity {
  supabaseUserId: string;
  email: string;
}

export interface SupabaseAuthClient {
  auth: {
    signInWithOtp(input: {
      email: string;
      options: { emailRedirectTo: string; shouldCreateUser: boolean };
    }): Promise<{ error: SupabaseAuthError | null }>;
    verifyOtp(input:
      | { token_hash: string; type: SupabaseOtpType }
      | { email: string; token: string; type: 'email' | 'magiclink' }
    ): Promise<{ data: { user: SupabaseUser | null }; error: SupabaseAuthError | null }>;
    getUser(jwt: string): Promise<{
      data: { user: SupabaseUser | null };
      error: SupabaseAuthError | null;
    }>;
  };
}

export interface SupabaseAuthEnv {
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  MAGIC_LINK_TTL_MINUTES?: string;
}

export function createSupabaseAuthClient(env: SupabaseAuthEnv = process.env): SupabaseAuthClient {
  const url = requiredSupabaseEnv(env.SUPABASE_URL, 'SUPABASE_URL');
  const anonKey = requiredSupabaseEnv(env.SUPABASE_ANON_KEY, 'SUPABASE_ANON_KEY');
  return createClient(url, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }) as unknown as SupabaseAuthClient;
}

export async function sendSupabaseMagicLink(options: {
  email: string;
  redirectTo: string;
  env?: SupabaseAuthEnv;
  client?: SupabaseAuthClient;
  now?: Date;
}): Promise<{ email: string; expiresAt: Date }> {
  const email = normalizeEmail(options.email);
  const client = options.client ?? createSupabaseAuthClient(options.env);
  const { error } = await client.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: options.redirectTo,
      shouldCreateUser: true,
    },
  });
  if (error) throw new Error(`supabase_magic_link_failed:${error.message}`);

  const ttl = Number(
    options.env?.MAGIC_LINK_TTL_MINUTES ??
      process.env.MAGIC_LINK_TTL_MINUTES ??
      DEFAULT_MAGIC_LINK_TTL_MINUTES,
  );
  const now = options.now ?? new Date();
  return { email, expiresAt: new Date(now.getTime() + ttl * 60 * 1000) };
}

export async function verifySupabaseIdentity(options: {
  accessToken?: string;
  tokenHash?: string;
  type?: string;
  email?: string;
  token?: string;
  client?: SupabaseAuthClient;
  env?: SupabaseAuthEnv;
}): Promise<SupabaseIdentity> {
  const client = options.client ?? createSupabaseAuthClient(options.env);
  const type = normalizeOtpType(options.type);
  let user: SupabaseUser | null = null;
  let error: SupabaseAuthError | null = null;

  if (options.accessToken) {
    const result = await client.auth.getUser(options.accessToken);
    user = result.data.user;
    error = result.error;
  } else if (options.tokenHash && type) {
    const result = await client.auth.verifyOtp({ token_hash: options.tokenHash, type });
    user = result.data.user;
    error = result.error;
  } else if (options.email && options.token) {
    const result = await client.auth.verifyOtp({
      email: normalizeEmail(options.email),
      token: options.token,
      type: type === 'magiclink' ? 'magiclink' : 'email',
    });
    user = result.data.user;
    error = result.error;
  } else {
    throw new Error('supabase_verify_input_required');
  }

  if (error) throw new Error(`supabase_verify_failed:${error.message}`);
  if (!user?.id || !user.email) throw new Error('supabase_user_missing_email');
  return {
    supabaseUserId: user.id,
    email: normalizeEmail(user.email),
  };
}

function normalizeEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new Error('email_invalid');
  }
  return normalized;
}

function normalizeOtpType(type?: string): SupabaseOtpType | null {
  if (!type) return null;
  if (['signup', 'magiclink', 'recovery', 'invite', 'email'].includes(type)) {
    return type as SupabaseOtpType;
  }
  return null;
}

function requiredSupabaseEnv(value: string | undefined, name: string): string {
  if (!value || value.startsWith('your-') || value.includes('your-project')) {
    throw new Error(`${name} is required`);
  }
  return value;
}
