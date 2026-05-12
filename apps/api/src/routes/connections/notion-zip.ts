import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

import { and, eq, sql } from 'drizzle-orm';
import { Router } from 'express';
import multer from 'multer';

import { getWorkspaceReadiness } from '../../auth/membership.js';
import { db, schema } from '../../db/client.js';

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

const upload = multer({
  dest: tmpdir(),
  // Defense in depth: cap upload at 100 MB (HTTP/multer layer); the connector
  // itself enforces per-entry, total, and compression-ratio limits.
  // `files: 1, fields: 0` rejects multipart bodies that try to smuggle extra parts.
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 0 },
});

/**
 * Notion zip upload route, scoped to the workspace named in the parent path
 * (`/workspaces/:id/connections/notion-zip`). The `requireMembership`
 * middleware (mounted on the parent path) has already asserted membership,
 * so the handler reads `req.workspace!.id` directly. `mergeParams: true`
 * keeps the parent `:id` visible inside this router.
 */
export function buildNotionZipRouter(deps: { kick: (workspaceId: string) => Promise<void> }) {
  const router = Router({ mergeParams: true });

  router.post('/', upload.single('file'), async (req, res, next) => {
    try {
      const workspaceId = req.workspace!.id;
      if (!req.file) {
        res.status(400).json({ error: 'file_required' });
        return;
      }

      const filename = req.file.originalname || 'notion-export.zip';
      const zipPath = req.file.path;

      // Reject if the tenant runtime isn't ready — the connector immediately
      // kicks an ingest job against gbrain, which would fail or silently
      // queue against a runtime that doesn't exist yet. Drop the temp file.
      const readiness = await getWorkspaceReadiness(workspaceId);
      if (!readiness || readiness.status !== 'ready' || !readiness.gbrainReady) {
        await rm(zipPath, { force: true }).catch(() => undefined);
        res.status(425).json({
          error: 'workspace_not_ready',
          status: readiness?.status ?? 'unknown',
        });
        return;
      }

      if (await hasActiveNotionConnection(workspaceId)) {
        await rm(zipPath, { force: true }).catch(() => undefined);
        res.status(409).json({ error: 'notion_connection_exists' });
        return;
      }

      let connectionId = '';
      try {
        const [row] = await db
          .insert(schema.connections)
          .values({
            workspaceId,
            kind: 'notion-zip',
            status: 'pending_import',
            displayName: `Notion · ${filename}`,
            cursor: { zipPath },
          })
          .returning();
        connectionId = row?.id ?? '';
      } catch (err) {
        await rm(zipPath, { force: true }).catch(() => undefined);
        if (isUniqueViolation(err)) {
          res.status(409).json({ error: 'notion_connection_exists' });
          return;
        }
        throw err;
      }

      void deps.kick(workspaceId).catch(() => undefined);
      res.json({ ok: true, connectionId });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

async function hasActiveNotionConnection(workspaceId: string): Promise<boolean> {
  const rows = await db
    .select({ id: schema.connections.id })
    .from(schema.connections)
    .where(
      and(
        eq(schema.connections.workspaceId, workspaceId),
        sql`${schema.connections.kind}::text LIKE 'notion-%'`,
        sql`${schema.connections.status} <> 'disconnected'`,
      ),
    )
    .limit(1);
  return rows.length > 0;
}

function isUniqueViolation(err: unknown): boolean {
  return Boolean(err && typeof err === 'object' && (err as { code?: string }).code === '23505');
}
