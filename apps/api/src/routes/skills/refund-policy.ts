import { eq } from 'drizzle-orm';
import { Router, type Request } from 'express';

import { validateSession } from '../../auth/sessions.js';
import { db, schema } from '../../db/client.js';
import { GbrainClient } from '../../gbrain/client.js';
import { generateRefundPolicySkill } from '../../skills/refund-policy/generate.js';

export const refundPolicySkillRouter = Router();

refundPolicySkillRouter.post('/', async (req, res, next) => {
  try {
    const session = await sessionFromRequest(req);
    if (!session) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    const workspace = await workspaceForUser(session.userId);
    if (!workspace) {
      res.status(409).json({ error: 'workspace_not_ready' });
      return;
    }

    const gbrain = new GbrainClient({
      workspaceId: workspace.id,
      baseUrl: formatGbrainBaseUrl(workspace.flyPrivateIp),
      oauthClientId: workspace.gbrainOauthClientId,
      oauthClientSecretCiphertext: workspace.gbrainOauthClientSecretCiphertext,
    });
    const bundle = await generateRefundPolicySkill({
      gbrain,
      workspaceId: workspace.id,
      gbrainVersion: workspace.gbrainVersion,
      open42Version: process.env.npm_package_version ?? '0.1.0',
    });

    await db.insert(schema.skillExports).values({
      workspaceId: workspace.id,
      userId: session.userId,
      skillType: 'refund-policy',
      citationsCount: bundle.frontmatter.citations.length,
      sourcePagesOldestAt: bundle.frontmatter.freshness.oldest_source_at
        ? new Date(bundle.frontmatter.freshness.oldest_source_at)
        : null,
      stalenessWarning: bundle.frontmatter.freshness.staleness_warning,
    });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="refund-policy-skill.zip"');
    res.send(bundle.zip);
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
    !workspace?.flyPrivateIp ||
    !workspace.gbrainOauthClientId ||
    !workspace.gbrainOauthClientSecretCiphertext
  ) {
    return null;
  }
  return {
    id: workspace.id,
    flyPrivateIp: workspace.flyPrivateIp,
    gbrainOauthClientId: workspace.gbrainOauthClientId,
    gbrainOauthClientSecretCiphertext: workspace.gbrainOauthClientSecretCiphertext,
    gbrainVersion: workspace.gbrainVersion,
  };
}

function formatGbrainBaseUrl(privateIp: string): string {
  const host = privateIp.includes(':') && !privateIp.startsWith('[') ? `[${privateIp}]` : privateIp;
  return `http://${host}:8080`;
}
