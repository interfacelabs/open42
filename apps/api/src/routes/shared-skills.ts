import { Router } from 'express';

import { resolveShareLink } from '../skills/share-link.js';

export function buildSharedSkillsRouter(): Router {
  const router = Router();

  router.get('/:token.zip', async (req, res, next) => {
    try {
      const token = req.params.token;
      if (!token || !/^[A-Za-z0-9_-]{16,256}$/.test(token)) {
        res.status(404).json({ error: 'share_link_not_found' });
        return;
      }

      const resolved = await resolveShareLink(token);
      if (!resolved) {
        res.status(404).json({ error: 'share_link_not_found' });
        return;
      }

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${resolved.filename}"`);
      res.setHeader('Cache-Control', 'private, max-age=0, no-store');
      res.send(resolved.bundle);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
