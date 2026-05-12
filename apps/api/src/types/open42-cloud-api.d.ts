declare module '@open42/cloud/api' {
  import type express from 'express';
  import type pino from 'pino';

  export interface CloudApiHandle {
    stop(): void | Promise<void>;
  }

  export function registerCloudRuntime(): void;
  export function mountCloudWebhooks(app: express.Express): void;
  export function mountCloudRoutes(
    app: express.Express,
    deps: {
      logger?: Pick<pino.Logger, 'error' | 'info'>;
      requireRole: typeof import('../middleware/require-role.js').requireRole;
    },
  ): CloudApiHandle;
}
