import './env.js';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import pino from 'pino';

import { csrfMiddleware } from './middleware/csrf.js';
import { PINO_ERROR_REDACT_PATHS, sanitizeErrorForLog } from './middleware/error-sanitize.js';
import { requireMembership } from './middleware/require-membership.js';
import { requireRole } from './middleware/require-role.js';
import {
  COMPOSIO_BASE_URL,
  COMPOSIO_WEBHOOK_SECRET,
  OPEN42_COMPOSIO_ENABLED,
  OPEN42_EDITION,
  API_PUBLIC_URL,
  WEB_PUBLIC_URL,
  assertBootSecrets,
} from './env.js';
import { createComposioClient, noopComposioStub, type ComposioClient } from './composio/client.js';
import { makeConnectorRegistry } from './connectors/registry.js';
import { buildGbrainForWorkspace } from './gbrain/factory.js';
import { startScheduler, type SchedulerHandle } from './ingest/orchestrator.js';
import { sweepStaleCycles } from './ingest/staging.js';
import { closeAllRedisConnections } from './queue/connection.js';
import { closeProvisionQueue } from './queue/provision-queue.js';
import { startProvisionWorker, stopProvisionWorker } from './queue/provision-worker.js';
import { authRouter } from './routes/auth.js';
import { chatRouter } from './routes/chat.js';
import { buildNotionZipRouter } from './routes/connections/notion-zip.js';
import { buildComposioRouter } from './routes/connections/composio.js';
import { buildConnectionsRouter } from './routes/connections/index.js';
import { buildPublicGbrainProxyRouter } from './routes/gbrain-public-proxy.js';
import { buildAnthropicProxy, buildOpenAIProxy } from './routes/proxy/index.js';
import { workspaceCredentialsRouter } from './routes/workspaces/credentials.js';
import { buildAcceptRouter } from './routes/workspaces/accept.js';
import { buildIngestRouter } from './routes/workspaces/ingest.js';
import { buildWorkspaceIndexRouter } from './routes/workspaces/index-router.js';
import { buildInvitesRouter } from './routes/workspaces/invites.js';
import { buildWorkspaceMcpProxyRouter } from './routes/workspaces/mcp-proxy.js';
import { buildMembersRouter } from './routes/workspaces/members.js';
import { buildWorkspaceProvisionRouter } from './routes/workspaces/provision.js';
import { buildHealthzRouter } from './routes/healthz.js';
import { libraryRouter } from './routes/library/index.js';
import { skillsRouter } from './routes/skills/mint.js';
import { buildComposioWebhookRouter } from './routes/webhooks/composio.js';
import {
  runWorkspaceCycle,
  type OrchestratorDeps,
  type RunCycleOptions,
} from './ingest/orchestrator.js';

type CloudApiModule = typeof import('@open42/cloud/api');

const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  // Defense-in-depth against accidental error-body leaks. The primary
  // sanitization happens via `sanitizeErrorForLog` (used in this file's error
  // handler and exported for use elsewhere). These redact paths catch any
  // future caller that forgets and passes a raw error or request body
  // straight to the logger. See middleware/error-sanitize.ts.
  redact: { paths: [...PINO_ERROR_REDACT_PATHS], remove: true },
  transport:
    process.env.NODE_ENV !== 'production'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
});

const app = express();
const port = Number(
  process.env.API_PORT ?? process.env.PORT ?? portFromUrl(process.env.API_PUBLIC_URL) ?? 3001,
);
assertBootSecrets();

export let composio: ComposioClient | null = null;
export let scheduler: SchedulerHandle | null = null;
let orchestratorDeps: OrchestratorDeps | null = null;
const connectionRouteDeps: { composio: ComposioClient | null } = { composio: null };
const cloudApi = await loadCloudApi();
export let cloudHandle: { stop(): void | Promise<void> } | null = null;

cloudApi?.registerCloudRuntime?.();

export async function kickWorkspaceIngest(workspaceId: string): Promise<void> {
  await scheduler?.kick(workspaceId);
}

void (async () => {
  try {
    if (OPEN42_COMPOSIO_ENABLED) {
      composio = await createComposioClient({
        apiKey: process.env.COMPOSIO_API_KEY ?? '',
        baseUrl: COMPOSIO_BASE_URL,
      });
    } else {
      logger.warn(
        'COMPOSIO_API_KEY not set - Composio-backed connectors unavailable; zip ingestion still works',
      );
    }
    const registry = makeConnectorRegistry(composio);
    orchestratorDeps = {
      composio: composio ?? noopComposioStub(),
      gbrain: buildGbrainForWorkspace,
      resolveConnector: registry.resolveConnectorByKind,
    };
    connectionRouteDeps.composio = composio;
    scheduler = startScheduler(orchestratorDeps);
  } catch (err) {
    logger.error({ err: sanitizeErrorForLog(err) }, 'ingest_scheduler_boot_failed');
  }
})();

// Trust the outer reverse proxy in deployed environments.
app.set('trust proxy', 1);

app.use(
  helmet({
    contentSecurityPolicy: false, // configured later when we know the embed surfaces
  }),
);
app.use(
  cors({
    origin: WEB_PUBLIC_URL,
    credentials: true,
  }),
);
// Wildcard public gbrain MCP host. Mounted before body parsers so MCP/OAuth
// request bodies can be streamed through untouched.
app.use(buildPublicGbrainProxyRouter());
app.use('/proxy/openai', buildOpenAIProxy());
app.use('/proxy/anthropic', buildAnthropicProxy());
// Webhook router declares its own express.raw — must mount before express.json
// so the HMAC verification sees the unparsed bytes Composio actually signed.
app.use(
  '/webhooks/composio',
  buildComposioWebhookRouter({
    secret: COMPOSIO_WEBHOOK_SECRET,
    kick: kickWorkspaceIngest,
  }),
);
cloudApi?.mountCloudWebhooks?.(app);
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(
  csrfMiddleware({
    allowedOrigins: [WEB_PUBLIC_URL, API_PUBLIC_URL],
  }),
);

// Routes
app.use('/healthz', buildHealthzRouter({ notReady: () => !scheduler }));
app.use('/auth', authRouter);
// Connections live under `/workspaces/:id/connections/...` so the workspace
// is supplied via the path and `requireMembership` can assert the caller is
// a member before the handler runs. The previous flat `/connections/*`
// mounts read `users.currentWorkspaceId` for authorization — a cross-tenant
// hole, since that column is writable and not the legitimate auth claim.
app.use(
  '/workspaces/:id/connections',
  requireMembership({ from: 'param' }),
  buildConnectionsRouter(connectionRouteDeps),
);
app.use(
  '/workspaces/:id/connections',
  requireMembership({ from: 'param' }),
  buildComposioRouter({ kick: kickWorkspaceIngest }),
);
app.use(
  '/workspaces/:id/connections/notion-zip',
  requireMembership({ from: 'param' }),
  buildNotionZipRouter({ kick: kickWorkspaceIngest }),
);
app.use('/workspaces', buildWorkspaceProvisionRouter());
// Top-level workspace CRUD (list / create / switch). Mounted AFTER the
// onboarding-specific provision router so onboarding paths (`/onboarding/...`,
// `/current`, `/onboarding/retry-provision`) keep winning for their exact
// URLs; the index router only declares `/`, `/:id/switch` so there is no
// collision.
app.use('/workspaces', buildWorkspaceIndexRouter());
app.use('/workspaces', buildInvitesRouter());
app.use('/workspaces', buildMembersRouter());
// Signed-in invite-accept fast path (Path B). Lives under `/workspaces` to
// keep all workspace-shaped URLs together. No `requireMembership` here —
// acceptance is what CREATES the membership row.
app.use('/workspaces', buildAcceptRouter());
// Workspace BYOK credentials live under `/workspaces/:id/credentials`. The
// route is owner-only: BYOK keys are billing-sensitive secrets, and the
// pre-migration `/workspaces/credentials` mount (resolveOwnerWorkspaceId)
// already restricted to workspaces the caller owned. The intermediate
// migration to `requireMembership({ from: 'param' })` silently downgraded
// this gate to "any member", letting non-owner members view, add, and
// delete keys. `requireRole(['owner'])` restores the original owner-only
// invariant. The web UI at apps/web/pages/auth/settings/api-keys.tsx
// already handles the 403 path by showing a "Only workspace owners can
// manage API keys" notice (data-testid=api-keys-forbidden).
app.use(
  '/workspaces/:id/credentials',
  requireRole(['owner'], { from: 'param' }, 'forbidden_owner_only'),
  workspaceCredentialsRouter,
);
app.use(
  '/workspaces/:id/mcp-proxy',
  requireRole(['owner', 'admin'], { from: 'param' }, 'forbidden_cannot_manage_mcp_proxy'),
  buildWorkspaceMcpProxyRouter(),
);
cloudHandle = cloudApi?.mountCloudRoutes?.(app, { logger, requireRole }) ?? null;
app.use(
  '/workspaces',
  buildIngestRouter({
    runCycle: async (workspaceId: string, opts?: RunCycleOptions) => {
      if (!orchestratorDeps) throw new Error('ingest_scheduler_not_ready');
      return runWorkspaceCycle(orchestratorDeps, workspaceId, opts);
    },
  }),
);
app.use('/chat', chatRouter);
// Library lives under `/workspaces/:id/library` so the caller's membership is
// asserted via `requireMembership` instead of falling back to "first owned
// workspace" — broken for users who own 2+.
app.use('/workspaces/:id/library', requireMembership({ from: 'param' }), libraryRouter);
// Same shape for skills (list / read / mint / revise / export). Was
// previously mounted at `/skills` and resolved "first owned workspace" via
// resolveOwnerWorkspaceId — broken under multi-workspace ownership.
app.use('/workspaces/:id/skills', requireMembership({ from: 'param' }), skillsRouter);

// Fallback 404
app.use((_req, res) => {
  res.status(404).json({ error: 'not_found' });
});

// Error handler. Codex review #2: never log raw `err` — gbrain (or any
// upstream) may echo tool args inside error payloads, which Pino's default
// serializer would walk verbatim into our persistent logs. `sanitizeErrorForLog`
// allow-lists name/message/code/status/bodyLength only.
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error({ err: sanitizeErrorForLog(err) }, 'unhandled_error');
  res.status(500).json({ error: 'internal_error' });
});

const server = app.listen(port, () => {
  logger.info(`open42-api listening on :${port}`);
  void sweepStaleCycles(60 * 60 * 1000);
  // Start the BullMQ worker that processes tenant-provision jobs. BullMQ
  // handles stalled-job recovery natively — if this process dies mid-job,
  // another worker (or this same process on restart) picks the job back
  // up after the stalled-interval timeout. No DB sweep required.
  startProvisionWorker();
});

// Graceful shutdown — drain in-flight jobs, close Redis sockets, then exit.
// Without this a SIGTERM (Conductor restart, deploy, ctrl-C) would kill
// active provisioning jobs mid-flight; BullMQ would still recover them, but
// at the cost of an extra ~30s stall before the next worker picks up.
let shuttingDown = false;
async function gracefulShutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutdown_initiated');
  // Stop accepting new HTTP requests first so in-flight ones can finish.
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (scheduler) {
    await scheduler.stop();
  }
  await cloudHandle?.stop();
  await stopProvisionWorker();
  await closeProvisionQueue();
  await closeAllRedisConnections();
  logger.info('shutdown_complete');
  process.exit(0);
}
process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => void gracefulShutdown('SIGINT'));

function portFromUrl(value?: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.port) return url.port;
    return url.protocol === 'https:' ? '443' : '80';
  } catch {
    return null;
  }
}

async function loadCloudApi(): Promise<CloudApiModule | null> {
  if (OPEN42_EDITION !== 'cloud') return null;
  return import('@open42/cloud/api');
}
