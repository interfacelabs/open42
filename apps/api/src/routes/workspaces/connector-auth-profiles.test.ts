import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { ComposioProfileError } from '../../composio/profiles.js';
import { buildConnectorAuthProfilesRouter } from './connector-auth-profiles.js';

describe('connector auth profile routes', () => {
  it('lists profiles without returning secrets or ciphertext', async () => {
    const app = buildApp({
      listProfiles: async () => [
        {
          id: 'open42-managed',
          mode: 'open42_managed',
          label: 'Open42 managed Composio',
          provider: 'composio',
          services: [{ serviceId: 'notion', configured: true, enabled: true }],
          createdAt: null,
          updatedAt: null,
        },
        {
          id: 'profile-1',
          mode: 'byok',
          label: 'Customer Composio',
          provider: 'composio',
          services: [{ serviceId: 'notion', configured: true, enabled: true }],
          createdAt: new Date('2026-05-16T12:00:00Z'),
          updatedAt: new Date('2026-05-16T12:00:00Z'),
        },
      ],
    });

    const res = await request(app).get('/workspaces/ws-1/connector-auth-profiles').expect(200);
    expect(res.body.profiles).toHaveLength(2);
    expect(JSON.stringify(res.body)).not.toMatch(/apiKey|ciphertext|secret/i);
  });

  it('passes a BYOK profile upsert through with workspace and user context', async () => {
    const upsertProfile = vi.fn(async () => ({ id: 'profile-1' }));
    const app = buildApp({ upsertProfile });

    await request(app)
      .post('/workspaces/ws-1/connector-auth-profiles')
      .send({
        label: 'Customer Composio',
        apiKey: 'composio-key',
        notionAuthConfigId: 'auth-config-1',
      })
      .expect(200, { ok: true, profileId: 'profile-1' });

    expect(upsertProfile).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      userId: 'user-1',
      profileId: null,
      label: 'Customer Composio',
      apiKey: 'composio-key',
      services: { notion: { authConfigId: 'auth-config-1', enabled: true } },
    });
  });

  it('rejects malformed upsert bodies before touching storage', async () => {
    const upsertProfile = vi.fn();
    const app = buildApp({ upsertProfile });

    await request(app)
      .post('/workspaces/ws-1/connector-auth-profiles')
      .send({ apiKey: 'composio-key' })
      .expect(400, { error: 'invalid_connector_auth_profile' });

    expect(upsertProfile).not.toHaveBeenCalled();
  });

  it('maps profile delete conflicts to a non-secret error', async () => {
    const app = buildApp({
      deleteProfile: async () => {
        throw new ComposioProfileError('connector_auth_profile_in_use', 409);
      },
    });

    await request(app)
      .delete('/workspaces/ws-1/connector-auth-profiles/profile-1')
      .expect(409, { error: 'connector_auth_profile_in_use' });
  });
});

function buildApp(deps: Parameters<typeof buildConnectorAuthProfilesRouter>[0] = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.workspace = { id: 'ws-1', role: 'admin' };
    req.session = { id: 'sess-1', userId: 'user-1' };
    next();
  });
  app.use('/workspaces/:id/connector-auth-profiles', buildConnectorAuthProfilesRouter(deps));
  return app;
}
