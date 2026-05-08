import { describe, expect, it } from 'vitest';
import { signState, verifyState, type StatePayload } from './state-hmac.js';

const payload: StatePayload = {
  workspaceId: 'workspace-1',
  userId: 'user-1',
  nonce: 'nonce-1',
  expiresAt: Date.now() + 60_000,
};

describe('state HMAC', () => {
  it('verifies a signed state payload', () => {
    const state = signState('secret', payload);
    expect(verifyState('secret', state)).toEqual(payload);
  });

  it('rejects a tampered mac', () => {
    const state = signState('secret', payload);
    const replacement = state.endsWith('0') ? '1' : '0';
    expect(verifyState('secret', `${state.slice(0, -1)}${replacement}`)).toBeNull();
  });

  it('rejects a tampered payload', () => {
    const state = signState('secret', payload);
    const [, mac] = state.split('.');
    const tampered = `${Buffer.from(JSON.stringify({ ...payload, userId: 'other' })).toString(
      'base64url',
    )}.${mac}`;
    expect(verifyState('secret', tampered)).toBeNull();
  });

  it('rejects expired payloads', () => {
    const state = signState('secret', { ...payload, expiresAt: Date.now() - 1 });
    expect(verifyState('secret', state)).toBeNull();
  });
});
