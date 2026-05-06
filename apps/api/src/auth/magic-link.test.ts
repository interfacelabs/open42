import { describe, expect, it } from 'vitest';

import type { MagicLinkRecord, MagicLinkRepo } from './magic-link.js';
import { consumeMagicLink, createMagicLink, generateMagicLinkToken } from './magic-link.js';

describe('magic links', () => {
  it('generates a 256-bit token encoded as 64 hex chars', () => {
    expect(generateMagicLinkToken()).toMatch(/^[0-9a-f]{64}$/);
  });

  it('creates a 15-minute single-use link', async () => {
    const repo = memoryRepo();
    const now = new Date('2026-05-06T10:00:00Z');
    const link = await createMagicLink(' User@Example.COM ', repo, now);

    expect(link.email).toBe('user@example.com');
    expect(link.expiresAt.toISOString()).toBe('2026-05-06T10:15:00.000Z');
    await expect(consumeMagicLink(link.token, repo, now)).resolves.toMatchObject({
      email: 'user@example.com',
    });
    await expect(consumeMagicLink(link.token, repo, now)).rejects.toThrow('magic_link_invalid');
  });

  it('rejects invalid email addresses before persistence', async () => {
    const repo = memoryRepo();

    await expect(createMagicLink('not-an-email', repo)).rejects.toThrow('email_invalid');
  });

  it('rejects expired links', async () => {
    const repo = memoryRepo();
    const link = await createMagicLink('user@example.com', repo, new Date('2026-05-06T10:00:00Z'));

    await expect(
      consumeMagicLink(link.token, repo, new Date('2026-05-06T10:16:00Z')),
    ).rejects.toThrow('magic_link_expired');
  });
});

function memoryRepo(): MagicLinkRepo {
  const links = new Map<string, MagicLinkRecord>();
  return {
    async create(record) {
      links.set(record.token, record);
    },
    async findUnused(token) {
      const record = links.get(token);
      return record && !record.usedAt ? record : null;
    },
    async markUsed(token, usedAt) {
      const record = links.get(token);
      if (record) links.set(token, { ...record, usedAt });
    },
  };
}
