import { describe, expect, it } from 'vitest';

import {
  canonicalizeSkillMarkdown,
  generateWorkspaceSigningMaterial,
  getOrCreateWorkspaceSigningKey,
  signCanonicalSkillMarkdown,
  verifyCanonicalSkillMarkdownSignature,
  WORKSPACE_SIGNING_KEY_PURPOSE,
} from './signing.js';
import type { GetOrCreateSigningKeyDeps } from './signing.js';

describe('skill signing', () => {
  it('normalizes markdown before signing', () => {
    expect(canonicalizeSkillMarkdown('---\r\nname: test  \r\n---\r\n\r\nBody\r\n\r\n')).toBe(
      '---\nname: test\n---\n\nBody\n',
    );
  });

  it('signs the canonical skill hash and verifies with the public key', () => {
    const keys = generateWorkspaceSigningMaterial('workspace-1');
    const markdown = '---\nname: refund-policy\n---\n\nUse cited facts.\n';

    const signature = signCanonicalSkillMarkdown(markdown, keys.privateKey);

    expect(signature.payloadSha256Hex).toMatch(/^[0-9a-f]{64}$/);
    expect(
      verifyCanonicalSkillMarkdownSignature({
        markdown,
        signature: signature.signatureBase64,
        publicKeyPem: keys.publicKey,
      }),
    ).toBe(true);
  });

  it('rejects a signature when SKILL.md changes', () => {
    const keys = generateWorkspaceSigningMaterial('workspace-1');
    const signature = signCanonicalSkillMarkdown('---\nname: a\n---\n\nA\n', keys.privateKey);

    expect(
      verifyCanonicalSkillMarkdownSignature({
        markdown: '---\nname: a\n---\n\nB\n',
        signature: signature.signature,
        publicKeyPem: keys.publicKey,
      }),
    ).toBe(false);
  });

  it('stores workspace private keys through envelope encryption with the signing purpose', async () => {
    let encryptedPrivateKey = '';
    let inserted:
      | {
          workspaceId: string;
          publicKey: string;
          privateKeyCiphertext: Buffer;
        }
      | undefined;
    let encryptedFor:
      | {
          workspaceId?: string;
          purpose?: string;
        }
      | undefined;
    let decryptedFor:
      | {
          workspaceId?: string;
          purpose?: string;
        }
      | undefined;

    const rows = () =>
      inserted
        ? [
            {
              publicKey: inserted.publicKey,
              privateKeyCiphertext: inserted.privateKeyCiphertext,
            },
          ]
        : [];
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => rows(),
          }),
        }),
      }),
      insert: () => ({
        values: async (row: {
          workspaceId: string;
          publicKey: string;
          privateKeyCiphertext: Buffer;
        }) => {
          inserted = row;
        },
      }),
    } as unknown as NonNullable<GetOrCreateSigningKeyDeps['db']>;

    const first = await getOrCreateWorkspaceSigningKey('workspace-1', {
      db,
      encrypt: (value, options) => {
        encryptedPrivateKey = value;
        encryptedFor = options;
        return Buffer.from('ciphertext');
      },
      decrypt: (value, options) => {
        expect(value).toEqual(Buffer.from('ciphertext'));
        decryptedFor = options;
        return encryptedPrivateKey;
      },
    });
    const second = await getOrCreateWorkspaceSigningKey('workspace-1', {
      db,
      encrypt: () => {
        throw new Error('existing signing keys must not be re-encrypted');
      },
      decrypt: (value, options) => {
        expect(value).toEqual(Buffer.from('ciphertext'));
        decryptedFor = options;
        return encryptedPrivateKey;
      },
    });

    expect(first.privateKey).toContain('BEGIN PRIVATE KEY');
    expect(inserted?.privateKeyCiphertext).toEqual(Buffer.from('ciphertext'));
    expect(inserted?.privateKeyCiphertext.toString('utf8')).not.toContain('BEGIN PRIVATE KEY');
    expect(encryptedFor).toEqual({
      workspaceId: 'workspace-1',
      purpose: WORKSPACE_SIGNING_KEY_PURPOSE,
    });
    expect(decryptedFor).toEqual({
      workspaceId: 'workspace-1',
      purpose: WORKSPACE_SIGNING_KEY_PURPOSE,
    });
    expect(second).toEqual(first);
  });
});
