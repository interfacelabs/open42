import type express from 'express';

export interface CloudApiHandle {
  stop(): void | Promise<void>;
}

export function registerCloudRuntime(): void {
  // Community edition: no cloud provisioners or billing usage hooks.
}

export function mountCloudWebhooks(_app: express.Express): void {
  // Community edition: no cloud webhooks.
}

export function mountCloudRoutes(_app: express.Express): CloudApiHandle {
  return {
    stop() {
      // Community edition: no background cloud loops.
    },
  };
}
