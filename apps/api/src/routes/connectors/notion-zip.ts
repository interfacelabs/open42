import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { eq } from 'drizzle-orm';
import { Router, type Request } from 'express';
import multer from 'multer';

import { validateSession } from '../../auth/sessions.js';
import { NotionZipConnector } from '../../connectors/notion-zip/index.js';
import { db, schema } from '../../db/client.js';
import { GbrainClient } from '../../gbrain/client.js';

const upload = multer({
  dest: tmpdir(),
  limits: { fileSize: 500 * 1024 * 1024 },
});

export const notionZipRouter = Router();

notionZipRouter.post('/', upload.single('file'), async (req, res, next) => {
  try {
    const session = await sessionFromRequest(req);
    if (!session) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: 'file_required' });
      return;
    }

    const workspace = await workspaceForUser(session.userId);
    if (!workspace) {
      res.status(409).json({ error: 'workspace_not_ready' });
      return;
    }

    const stagingDir = await mkdtemp(join(tmpdir(), 'open42-notion-'));
    const connector = new NotionZipConnector();
    let pagesTotal = 0;
    for await (const doc of connector.extract({ zipPath: req.file.path })) {
      pagesTotal += 1;
      await writeFile(join(stagingDir, `${doc.slug}.md`), doc.content_md, 'utf8');
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
    const submitted = (await gbrain.submitJob('sync', { path: stagingDir })) as {
      id?: string | number;
      job_id?: string | number;
    };
    const gbrainJobId = String(submitted.id ?? submitted.job_id ?? '');

    const [job] = await db
      .insert(schema.ingestJobs)
      .values({
        workspaceId: workspace.id,
        gbrainJobId,
        status: 'running',
        pagesTotal,
        // TODO(Chunk-4): route is replaced by /connections/notion-zip and the orchestrator.
        connectorsSummary: [{ connection_id: 'legacy-notion-zip', kind: 'notion-zip', pages: pagesTotal }],
        startedAt: new Date(),
      })
      .returning();

    res.json({ ok: true, jobId: job?.id, gbrainJobId, pagesTotal });
  } catch (err) {
    next(err);
  }
});

notionZipRouter.get('/jobs/:id', async (req, res, next) => {
  try {
    const session = await sessionFromRequest(req);
    if (!session) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }

    const [job] = await db
      .select()
      .from(schema.ingestJobs)
      .where(eq(schema.ingestJobs.id, req.params.id))
      .limit(1);
    if (!job) {
      res.status(404).json({ error: 'job_not_found' });
      return;
    }

    res.json({
      id: job.id,
      status: job.status,
      pagesTotal: job.pagesTotal,
      // TODO(Chunk-4): progress is reported via connectorsSummary after the route refactor.
      pagesProcessed: job.pagesTotal,
      error: job.error,
      completedAt: job.completedAt?.toISOString() ?? null,
    });
  } catch (err) {
    next(err);
  }
});

async function sessionFromRequest(req: Request) {
  const sessionId = req.cookies?.[process.env.SESSION_COOKIE_NAME ?? 'open42_session'];
  if (!sessionId) return null;
  return validateSession(sessionId, { userAgent: req.header('user-agent'), ip: req.ip });
}

async function workspaceForUser(userId: string) {
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

  if (
    !(workspace?.gbrainBaseUrl || workspace?.flyPrivateIp) ||
    !workspace.gbrainOauthClientId ||
    !workspace.gbrainOauthClientSecretCiphertext
  ) {
    return null;
  }
  return workspace;
}

function formatGbrainBaseUrl(privateIp: string): string {
  const host = privateIp.includes(':') && !privateIp.startsWith('[') ? `[${privateIp}]` : privateIp;
  return `http://${host}:8080`;
}
