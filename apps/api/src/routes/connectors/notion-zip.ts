import { unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';

import { and, eq } from 'drizzle-orm';
import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';

import { validateSession, type SessionRecord } from '../../auth/sessions.js';
import { NotionZipConnector } from '../../connectors/notion-zip/index.js';
import type { NormalizedDoc } from '../../connectors/interface.js';
import { db, schema } from '../../db/client.js';
import { GbrainClient } from '../../gbrain/client.js';

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

const upload = multer({
  dest: tmpdir(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 0 },
});

export const notionZipRouter = Router();

interface AuthenticatedRequest extends Request {
  open42Session?: SessionRecord;
}

notionZipRouter.post('/', requireSession, parseUpload, async (req, res, next) => {
  const authedReq = req as AuthenticatedRequest;
  try {
    const session = authedReq.open42Session;
    if (!session) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: 'file_required' });
      return;
    }

    const workspace = await currentWorkspaceForUser(session.userId);
    if (!workspace || !isWorkspaceReady(workspace)) {
      res.status(409).json({ error: 'workspace_not_ready' });
      return;
    }

    const connector = new NotionZipConnector();
    let pagesTotal = 0;
    const docs: NormalizedDoc[] = [];
    for await (const doc of connector.extract({ zipPath: req.file.path })) {
      pagesTotal += 1;
      docs.push(doc);
    }

    const gbrainBaseUrl = workspace.gbrainBaseUrl ?? formatGbrainBaseUrl(workspace.flyPrivateIp ?? '');
    const oauthClientId = workspace.gbrainOauthClientId;
    const oauthClientSecretCiphertext = workspace.gbrainOauthClientSecretCiphertext;
    if (!gbrainBaseUrl || !oauthClientId || !oauthClientSecretCiphertext) {
      res.status(409).json({ error: 'workspace_not_ready' });
      return;
    }

    const gbrain = new GbrainClient({
      workspaceId: workspace.id,
      baseUrl: gbrainBaseUrl,
      oauthClientId,
      oauthClientSecretCiphertext,
    });
    for (const doc of docs) {
      await gbrain.putPage(doc.slug, doc.content_md);
    }

    const [job] = await db
      .insert(schema.ingestJobs)
      .values({
        workspaceId: workspace.id,
        gbrainJobId: null,
        connector: 'notion-zip',
        status: 'completed',
        pagesTotal,
        pagesProcessed: pagesTotal,
        startedAt: new Date(),
        completedAt: new Date(),
      })
      .returning();

    res.json({ ok: true, jobId: job?.id, gbrainJobId: null, pagesTotal });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('notion_zip_')) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  } finally {
    if (req.file?.path) {
      await unlink(req.file.path).catch(() => undefined);
    }
  }
});

notionZipRouter.get('/jobs/:id', async (req, res, next) => {
  try {
    const session = await sessionFromRequest(req);
    if (!session) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    const workspace = await currentWorkspaceForUser(session.userId);
    if (!workspace) {
      res.status(404).json({ error: 'job_not_found' });
      return;
    }

    const [job] = await db
      .select()
      .from(schema.ingestJobs)
      .where(
        and(eq(schema.ingestJobs.id, req.params.id), eq(schema.ingestJobs.workspaceId, workspace.id)),
      )
      .limit(1);
    if (!job) {
      res.status(404).json({ error: 'job_not_found' });
      return;
    }

    res.json({
      id: job.id,
      status: job.status,
      pagesTotal: job.pagesTotal,
      pagesProcessed: job.pagesProcessed,
      error: job.error,
      completedAt: job.completedAt?.toISOString() ?? null,
    });
  } catch (err) {
    next(err);
  }
});

async function requireSession(req: Request, res: Response, next: NextFunction) {
  try {
    const session = await sessionFromRequest(req);
    if (!session) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    (req as AuthenticatedRequest).open42Session = session;
    next();
  } catch (err) {
    next(err);
  }
}

function parseUpload(req: Request, res: Response, next: NextFunction) {
  upload.single('file')(req, res, (err) => {
    if (!err) {
      next();
      return;
    }
    if (err instanceof multer.MulterError) {
      res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: err.code });
      return;
    }
    next(err);
  });
}

async function sessionFromRequest(req: Request) {
  const sessionId = req.cookies?.[process.env.SESSION_COOKIE_NAME ?? 'open42_session'];
  if (!sessionId) return null;
  return validateSession(sessionId, { userAgent: req.header('user-agent'), ip: req.ip });
}

async function currentWorkspaceForUser(userId: string) {
  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (!user?.currentWorkspaceId) return null;

  const [workspace] = await db
    .select()
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, user.currentWorkspaceId))
    .limit(1);

  return workspace ?? null;
}

function isWorkspaceReady(workspace: NonNullable<Awaited<ReturnType<typeof currentWorkspaceForUser>>>) {
  return Boolean(
    (workspace.gbrainBaseUrl || workspace.flyPrivateIp) &&
      workspace.gbrainOauthClientId &&
      workspace.gbrainOauthClientSecretCiphertext,
  );
}

function formatGbrainBaseUrl(privateIp: string): string {
  const host = privateIp.includes(':') && !privateIp.startsWith('[') ? `[${privateIp}]` : privateIp;
  return `http://${host}:8080`;
}
