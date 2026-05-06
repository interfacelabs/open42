import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import pino from 'pino';

import { healthzRouter } from './routes/healthz.js';

const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  transport:
    process.env.NODE_ENV !== 'production'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
});

const app = express();
const port = Number(process.env.API_PORT ?? 3001);

// Trust proxy in prod (Cloudflare → Fly).
app.set('trust proxy', 1);

app.use(
  helmet({
    contentSecurityPolicy: false, // configured later when we know the embed surfaces
  }),
);
app.use(
  cors({
    origin: process.env.WEB_PUBLIC_URL ?? 'http://localhost:3000',
    credentials: true,
  }),
);
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// Routes
app.use('/healthz', healthzRouter);

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
});
