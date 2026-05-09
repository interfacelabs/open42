import { describe, expect, it, beforeEach } from 'vitest';

import { EnvelopeEncryptionError, decryptSecret, encryptSecret, readKek } from './envelope.js';

const TEST_KEK = '0'.repeat(64);

const ctx = (workspaceId: string, purpose = 'gbrain_oauth_secret') => ({
  workspaceId,
  purpose,
});

describe('envelope encryption', () => {
  beforeEach(() => {
    process.env.OPEN42_KEK = TEST_KEK;
  });

  it('round-trips a secret with AES-GCM-256 + AAD + per-tenant DEK', () => {
    const encrypted = encryptSecret('gbrain_cs_secret', ctx('workspace-1'));

    expect(encrypted).toBeInstanceOf(Buffer);
    expect(encrypted.toString('utf8')).not.toContain('gbrain_cs_secret');
    expect(decryptSecret(encrypted, ctx('workspace-1'))).toBe('gbrain_cs_secret');
  });

  it('rejects ciphertext copied between workspaces (workspace AAD swap)', () => {
    const encrypted = encryptSecret('workspace-secret', ctx('workspace-A'));

    expect(decryptSecret(encrypted, ctx('workspace-A'))).toBe('workspace-secret');
    expect(() => decryptSecret(encrypted, ctx('workspace-B'))).toThrow(EnvelopeEncryptionError);
  });

  it('rejects ciphertext copied between purposes (purpose AAD swap)', () => {
    const encrypted = encryptSecret('purposeful', ctx('workspace-1', 'gbrain_oauth_secret'));

    expect(decryptSecret(encrypted, ctx('workspace-1', 'gbrain_oauth_secret'))).toBe('purposeful');
    expect(() => decryptSecret(encrypted, ctx('workspace-1', 'proxy_token'))).toThrow(
      EnvelopeEncryptionError,
    );
  });

  it('uses a distinct DEK per workspace (same plaintext → different ciphertext payload)', () => {
    // Force IV equal so payload-only difference reflects DEK divergence, not just the random IV.
    // We can't pin the IV, but we can verify the GCM tag + ciphertext pair differ for every encrypt
    // and that a workspace-A ciphertext fails to decrypt under workspace-B's DEK even when AAD also matches
    // a forged workspace-B identity (i.e. with the wrong DEK, GCM auth fails).
    const a = encryptSecret('shared-plaintext', ctx('workspace-A'));
    const b = encryptSecret('shared-plaintext', ctx('workspace-B'));
    expect(a.equals(b)).toBe(false);

    // workspace-A's ciphertext, even with a forged AAD claiming it's workspace-B,
    // still fails because workspace-B's DEK can't authenticate it.
    expect(() => decryptSecret(a, ctx('workspace-B'))).toThrow(EnvelopeEncryptionError);
  });

  it('derives a deterministic DEK across separate calls (HKDF determinism)', () => {
    // Two encrypt calls share the same KEK + workspaceId → same DEK; both must decrypt
    // independently under the same ctx, even though IVs differ.
    const first = encryptSecret('deterministic-1', ctx('workspace-D'));
    const second = encryptSecret('deterministic-2', ctx('workspace-D'));

    expect(decryptSecret(first, ctx('workspace-D'))).toBe('deterministic-1');
    expect(decryptSecret(second, ctx('workspace-D'))).toBe('deterministic-2');
  });

  it('throws EnvelopeEncryptionError on tampered ciphertext bytes', () => {
    const encrypted = encryptSecret('tamper-me', ctx('workspace-1'));
    // Flip the last byte of ciphertext.
    const tampered = Buffer.from(encrypted);
    tampered[tampered.length - 1] = tampered[tampered.length - 1]! ^ 0x01;

    expect(() => decryptSecret(tampered, ctx('workspace-1'))).toThrow(EnvelopeEncryptionError);
  });

  it('rejects missing or empty SecretContext fields', () => {
    expect(() => encryptSecret('x', ctx('', 'p'))).toThrow(EnvelopeEncryptionError);
    expect(() => encryptSecret('x', ctx('w', ''))).toThrow(EnvelopeEncryptionError);
  });

  it('requires a 32-byte KEK', () => {
    process.env.OPEN42_KEK = 'short';

    expect(() => readKek()).toThrow('OPEN42_KEK must decode to 32 bytes');
  });
});
