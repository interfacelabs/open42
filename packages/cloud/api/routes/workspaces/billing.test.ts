import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { buildWorkspaceBillingRouter } from './billing.js';

describe('workspace billing routes', () => {
  it('rejects unrecognized checkout billing modes instead of defaulting to platform', async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (
        req as typeof req & {
          workspace: { id: string; role: 'owner' };
          session: { id: string; userId: string };
        }
      ).workspace = {
        id: 'workspace-1',
        role: 'owner',
      };
      (
        req as typeof req & {
          workspace: { id: string; role: 'owner' };
          session: { id: string; userId: string };
        }
      ).session = {
        id: 'session-1',
        userId: 'user-1',
      };
      next();
    });
    app.use(buildWorkspaceBillingRouter());

    const res = await request(app).post('/checkout').send({ billingMode: 'BYOK' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'invalid_billing_mode' });
  });
});
