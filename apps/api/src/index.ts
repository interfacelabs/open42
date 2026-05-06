import './env.js';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import pino from 'pino';

import { csrfMiddleware } from './middleware/csrf.js';
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
import { notionZipRouter } from './routes/connectors/notion-zip.js';
import { healthzRouter } from './routes/healthz.js';
import { refundPolicySkillRouter } from './routes/skills/refund-policy.js';

const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  transport:
    process.env.NODE_ENV !== 'production'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
});

const app = express();
const port = Number(process.env.API_PORT ?? portFromUrl(process.env.API_PUBLIC_URL) ?? 3001);

export let composio: ComposioClient | null = null;
export let scheduler: SchedulerHandle | null = null;

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
    scheduler = startScheduler({
      composio: composio ?? noopComposioStub(),
      gbrain: buildGbrainForWorkspace,
      resolveConnector: registry.resolveConnectorByKind,
    });
  } catch (err) {
    logger.error({ err }, 'ingest_scheduler_boot_failed');
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
app.use('/healthz', healthzRouter);
app.use('/auth', authRouter);
app.use('/connectors/notion-zip', notionZipRouter);
app.use('/chat', chatRouter);
app.use('/skills/refund-policy', refundPolicySkillRouter);

// Fallback 404
app.use((_req, res) => {
  res.status(404).json({ error: 'not_found' });
});

// Error handler
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    logger.error({ err }, 'unhandled_error');
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
