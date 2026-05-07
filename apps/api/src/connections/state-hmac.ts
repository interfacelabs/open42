import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export interface StatePayload {
  workspaceId: string;
  userId: string;
  nonce: string;
  expiresAt: number;
}

export function signState(secret: string, payload: StatePayload): string {
  const json = JSON.stringify(payload);
  const mac = createHmac('sha256', secret).update(json).digest('hex');
  return `${Buffer.from(json, 'utf8').toString('base64url')}.${mac}`;
}

export function verifyState(secret: string, state: string): StatePayload | null {
  const parts = state.split('.');
  if (parts.length !== 2) return null;
  const [b64, mac] = parts as [string, string];
  let json: string;
  try {
    json = Buffer.from(b64, 'base64url').toString('utf8');
  } catch {
    return null;
  }

  const expected = createHmac('sha256', secret).update(json).digest();
  const provided = Buffer.from(mac, 'hex');
  if (provided.length !== expected.length) return null;
  if (!timingSafeEqual(provided, expected)) return null;

  let payload: StatePayload;
  try {
    payload = JSON.parse(json) as StatePayload;
  } catch {
    return null;
  }
  if (typeof payload.expiresAt !== 'number' || payload.expiresAt < Date.now()) return null;
  return payload;
}

export function generateNonce(): string {
  return randomBytes(16).toString('hex');
}
