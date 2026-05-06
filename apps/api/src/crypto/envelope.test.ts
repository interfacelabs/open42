import { describe, expect, it, beforeEach } from 'vitest';

import { decryptSecret, encryptSecret, readKek } from './envelope.js';

const TEST_KEK = '0'.repeat(64);

describe('envelope encryption', () => {
  beforeEach(() => {
    process.env.OPEN42_KEK = TEST_KEK;
  });

  it('round-trips a secret with AES-GCM-256', () => {
    const encrypted = encryptSecret('gbrain_cs_secret');

    expect(encrypted).toBeInstanceOf(Buffer);
    expect(encrypted.toString('utf8')).not.toContain('gbrain_cs_secret');
    expect(decryptSecret(encrypted)).toBe('gbrain_cs_secret');
  });

  it('supports authenticated associated data', () => {
    const encrypted = encryptSecret('workspace-secret', 'workspace-1');

    expect(decryptSecret(encrypted, 'workspace-1')).toBe('workspace-secret');
    expect(() => decryptSecret(encrypted, 'workspace-2')).toThrow();
  });

  it('requires a 32-byte KEK', () => {
    process.env.OPEN42_KEK = 'short';

    expect(() => readKek()).toThrow('OPEN42_KEK must decode to 32 bytes');
  });
});
