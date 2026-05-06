import { describe, expect, it } from 'vitest';

import type { SessionRecord, SessionRepo } from './sessions.js';
import { createSession, getIpFirstOctet, invalidateSession, validateSession } from './sessions.js';

describe('sessions', () => {
  it('creates a 30-day session with CSRF token and IP binding', async () => {
    const repo = memoryRepo();
    const session = await createSession(
      'user-1',
      { userAgent: 'test-agent', ip: '203.0.113.10' },
      repo,
      new Date('2026-05-06T10:00:00Z'),
    );

    expect(session.expiresAt.toISOString()).toBe('2026-06-05T10:00:00.000Z');
    expect(session.csrfToken).toMatch(/^[0-9a-f]{64}$/);
    expect(session.ipFirstOctet).toBe('203');
  });

  it('validates fingerprint and slides expiry', async () => {
    const repo = memoryRepo();
    const session = await createSession(
      'user-1',
      { userAgent: 'test-agent', ip: '203.0.113.10' },
      repo,
      new Date('2026-05-06T10:00:00Z'),
    );

    await expect(
      validateSession(
        session.id,
        { userAgent: 'test-agent', ip: '203.0.113.99' },
        repo,
        new Date('2026-05-07T10:00:00Z'),
      ),
    ).resolves.toMatchObject({ expiresAt: new Date('2026-06-06T10:00:00Z') });

    await expect(
      validateSession(
        session.id,
        { userAgent: 'other-agent', ip: '203.0.113.99' },
        repo,
        new Date('2026-05-07T10:00:00Z'),
      ),
    ).resolves.toBeNull();
  });

  it('invalidates sessions through the repository', async () => {
    const repo = memoryRepo();
    const session = await createSession(
      'user-1',
      { userAgent: 'test-agent', ip: '203.0.113.10' },
      repo,
      new Date('2026-05-06T10:00:00Z'),
    );

    await invalidateSession(session.id, repo);

    await expect(
      validateSession(
        session.id,
        { userAgent: 'test-agent', ip: '203.0.113.10' },
        repo,
        new Date('2026-05-07T10:00:00Z'),
      ),
    ).resolves.toBeNull();
  });

  it('rejects missing, expired, and IP-mismatched sessions', async () => {
    const repo = memoryRepo();
    const session = await createSession(
      'user-1',
      { userAgent: 'test-agent', ip: '203.0.113.10' },
      repo,
      new Date('2026-05-06T10:00:00Z'),
    );

    await expect(
      validateSession(
        'missing',
        { userAgent: 'test-agent', ip: '203.0.113.10' },
        repo,
        new Date('2026-05-07T10:00:00Z'),
      ),
    ).resolves.toBeNull();
    await expect(
      validateSession(
        session.id,
        { userAgent: 'test-agent', ip: '198.51.100.10' },
        repo,
        new Date('2026-05-07T10:00:00Z'),
      ),
    ).resolves.toBeNull();
    await expect(
      validateSession(
        session.id,
        { userAgent: 'test-agent', ip: '203.0.113.10' },
        repo,
        new Date('2026-06-06T10:00:00Z'),
      ),
    ).resolves.toBeNull();
  });

  it('extracts the first IP octet', () => {
    expect(getIpFirstOctet('198.51.100.2')).toBe('198');
    expect(getIpFirstOctet('2001:db8::1')).toBe('2001');
    expect(getIpFirstOctet('  , 198.51.100.2')).toBeNull();
    expect(getIpFirstOctet(null)).toBeNull();
  });
});

function memoryRepo(): SessionRepo {
  const sessions = new Map<string, SessionRecord>();
  return {
    async create(record) {
      const session = { id: `session-${sessions.size + 1}`, ...record };
      sessions.set(session.id, session);
      return session;
    },
    async find(id) {
      return sessions.get(id) ?? null;
    },
    async updateExpiry(id, expiresAt) {
      const session = sessions.get(id);
      if (session) sessions.set(id, { ...session, expiresAt });
    },
    async invalidate(id) {
      const session = sessions.get(id);
      if (session) sessions.set(id, { ...session, expiresAt: new Date(0) });
    },
  };
}
