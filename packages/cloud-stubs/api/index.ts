import type express from 'express';
import type pino from 'pino';

export interface CloudApiHandle {
  stop(): void | Promise<void>;
}

type RequireRole = (...args: never[]) => express.RequestHandler;

export function registerCloudRuntime(): void {
  // Community edition: no cloud provisioners or billing usage hooks.
}

export function mountCloudWebhooks(_app: express.Express): void {
  // Community edition: no cloud webhooks.
}

export function mountCloudRoutes(
  _app: express.Express,
  _deps: {
    logger?: Pick<pino.Logger, 'error' | 'info'>;
    requireRole: RequireRole;
  },
): CloudApiHandle {
  return {
    stop() {
      // Community edition: no background cloud loops.
    },
  };
}
