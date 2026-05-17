import { eq } from 'drizzle-orm';
import { Router } from 'express';

import { isUuid } from '../../auth/uuid.js';
import { db, schema } from '../../db/client.js';

export function buildWorkspaceSigningKeyRouter(): Router {
  const router = Router();

  router.get('/:id/signing-key.pub', async (req, res, next) => {
    try {
      const workspaceId = req.params.id;
      if (!workspaceId || !isUuid(workspaceId)) {
        res.status(404).json({ error: 'workspace_signing_key_not_found' });
        return;
      }

      const [key] = await db
        .select({ publicKey: schema.workspaceSigningKeys.publicKey })
        .from(schema.workspaceSigningKeys)
        .where(eq(schema.workspaceSigningKeys.workspaceId, workspaceId))
        .limit(1);

      if (!key) {
        res.status(404).json({ error: 'workspace_signing_key_not_found' });
        return;
      }

      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=300');
      res.send(key.publicKey);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
