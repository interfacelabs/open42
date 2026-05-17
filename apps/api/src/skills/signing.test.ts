import { describe, expect, it } from 'vitest';

import {
  canonicalizeSkillMarkdown,
  generateWorkspaceSigningMaterial,
  signCanonicalSkillMarkdown,
  verifyCanonicalSkillMarkdownSignature,
} from './signing.js';

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
});
