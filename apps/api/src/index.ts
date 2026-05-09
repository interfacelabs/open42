import './env.js';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import pino from 'pino';

import { csrfMiddleware } from './middleware/csrf.js';
import { PINO_ERROR_REDACT_PATHS, sanitizeErrorForLog } from './middleware/error-sanitize.js';
import {
  COMPOSIO_API_KEY,
  COMPOSIO_BASE_URL,
  API_PUBLIC_URL,
  WEB_PUBLIC_URL,
} from './env.js';
import {
  createComposioClient,
  noopComposioStub,
  type ComposioClient,
} from './composio/client.js';
import { makeConnectorRegistry } from './connectors/registry.js';
import { buildGbrainForWorkspace } from './gbrain/factory.js';
import { startScheduler, type SchedulerHandle } from './ingest/orchestrator.js';
import { sweepStaleCycles } from './ingest/staging.js';
import { authRouter } from './routes/auth.js';
import { chatRouter } from './routes/chat.js';
import { buildNotionZipRouter } from './routes/connections/notion-zip.js';
import { buildComposioRouter } from './routes/connections/composio.js';
import { buildConnectionsRouter } from './routes/connections/index.js';
import { buildAnthropicProxy, buildOpenAIProxy } from './routes/proxy/index.js';
import { buildIngestRouter } from './routes/workspaces/ingest.js';
import { buildWorkspaceProvisionRouter } from './routes/workspaces/provision.js';
import { buildHealthzRouter } from './routes/healthz.js';
import { refundPolicySkillRouter } from './routes/skills/refund-policy.js';
import { runWorkspaceCycle, type OrchestratorDeps, type RunCycleOptions } from './ingest/orchestrator.js';

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
const port = Number(process.env.API_PORT ?? portFromUrl(process.env.API_PUBLIC_URL) ?? 3001);

export let composio: ComposioClient | null = null;
export let scheduler: SchedulerHandle | null = null;
let orchestratorDeps: OrchestratorDeps | null = null;
const connectionRouteDeps: { composio: ComposioClient | null } = { composio: null };

export async function kickWorkspaceIngest(workspaceId: string): Promise<void> {
  await scheduler?.kick(workspaceId);
}

void (async () => {
  try {
    if (COMPOSIO_API_KEY) {
      composio = await createComposioClient({
        apiKey: COMPOSIO_API_KEY,
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

// Trust proxy in prod (Cloudflare → Fly).
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
app.use('/proxy/openai', buildOpenAIProxy());
app.use('/proxy/anthropic', buildAnthropicProxy());
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(
  csrfMiddleware({
    allowedOrigins: [
      WEB_PUBLIC_URL,
      API_PUBLIC_URL,
    ],
  }),
);

// Routes
app.use('/healthz', buildHealthzRouter({ notReady: () => !scheduler }));
app.use('/auth', authRouter);
app.use('/connections', buildConnectionsRouter(connectionRouteDeps));
app.use('/connections', buildComposioRouter({ kick: kickWorkspaceIngest }));
app.use('/connections/notion-zip', buildNotionZipRouter({ kick: kickWorkspaceIngest }));
app.use('/workspaces', buildWorkspaceProvisionRouter());
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
app.use('/skills/refund-policy', refundPolicySkillRouter);

// Fallback 404
app.use((_req, res) => {
  res.status(404).json({ error: 'not_found' });
});

// Error handler. Codex review #2: never log raw `err` — gbrain (or any
// upstream) may echo tool args inside error payloads, which Pino's default
// serializer would walk verbatim into our persistent logs. `sanitizeErrorForLog`
// allow-lists name/message/code/status/bodyLength only.
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    logger.error({ err: sanitizeErrorForLog(err) }, 'unhandled_error');
    res.status(500).json({ error: 'internal_error' });
  },
);

app.listen(port, () => {
  logger.info(`open42-api listening on :${port}`);
  void sweepStaleCycles(60 * 60 * 1000);
});

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
