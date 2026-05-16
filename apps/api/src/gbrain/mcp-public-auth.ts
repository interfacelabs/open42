import { createHash } from 'node:crypto';

const BEARER_PATTERN = /^Bearer\s+(.+)$/i;

export function hashMcpCredential(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

export function bearerToken(value: string | undefined): string | null {
  const match = value?.match(BEARER_PATTERN);
  return match?.[1]?.trim() || null;
}

export function clientIdFromTokenRequest(body: Buffer | undefined): string | null {
  if (!body?.length) return null;
  const params = new URLSearchParams(body.toString('utf8'));
  const clientId = params.get('client_id')?.trim();
  return clientId || null;
}

export function tokenFromRevokeRequest(body: Buffer | undefined): string | null {
  if (!body?.length) return null;
  const params = new URLSearchParams(body.toString('utf8'));
  const token = params.get('token')?.trim();
  return token || null;
}

export function accessTokenExpiry(value: unknown, now = Date.now()): Date {
  const expiresIn = Number(value ?? 3600);
  const seconds = Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600;
  return new Date(now + Math.trunc(seconds) * 1000);
}
