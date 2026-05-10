/**
 * BullMQ worker that processes tenant-provision jobs.
 *
 * Each job:
 *   1. Cleans up any leftover tenant from a prior failed attempt (idempotency).
 *   2. Runs `provisionTenant` — the same function that used to be invoked
 *      fire-and-forget. Success path persists `status='ready'` + gbrain
 *      credentials via `createWorkspace`.
 *   3. On error, BullMQ schedules the next retry (exponential backoff). When
 *      attempts are exhausted, BullMQ marks the job `failed`; the worker's
 *      `failed` event handler writes `status='failed'` to the DB so the UI
 *      can surface a retry button.
 *
 * Why we don't call `safelyProvisionTenant`: that wrapper writes
 * `status='failed'` after the *first* error, but BullMQ may still retry. We
 * only want the DB to flip to `failed` after BullMQ has truly given up.
 * Inside the worker we let raw `provisionTenant` errors bubble up to BullMQ.
 *
 * Stalled-job recovery: BullMQ Workers renew an internal lock every
 * `lockRenewTime` (default 15s). If the worker process dies, the lock
 * expires after `stalledInterval` (default 30s) and BullMQ moves the job
 * back to `waiting` for another worker to pick up. This is the durability
 * guarantee that replaces our crash-prone fire-and-forget Promise.
 */
import { Worker, type Job } from 'bullmq';
import { eq } from 'drizzle-orm';
import pino from 'pino';

import { db, schema } from '../db/client.js';
import { provisionTenant, classifyProvisioningError } from '../tenants/provision.js';
import { buildBullSubscriber } from './connection.js';
import {
  PROVISION_QUEUE_NAME,
  type ProvisionJobData,
} from './provision-queue.js';

const logger = pino({ name: 'provision-worker' });

let cachedWorker: Worker<ProvisionJobData> | null = null;

export function startProvisionWorker(): Worker<ProvisionJobData> {
  if (cachedWorker) return cachedWorker;

  const worker = new Worker<ProvisionJobData>(
    PROVISION_QUEUE_NAME,
    async (job) => processProvisionJob(job),
    {
      connection: buildBullSubscriber(),
      // 2 simultaneous provisions per worker — Docker pulls and gbrain health
      // polling are I/O-bound, so a small concurrency keeps us responsive
      // without saturating the host. Tune up in prod if needed.
      concurrency: 2,
      // Default 30s stalled-job recovery is fine — provisioning errors are
      // rare and the user-visible cost of a stall+restart is just an extra
      // ~30s waiting before retry kicks in.
    },
  );

  worker.on('active', (job) => {
    logger.info(
      { jobId: job.id, attempt: job.attemptsMade + 1, of: job.opts.attempts },
      'provision_job_active',
    );
  });

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id }, 'provision_job_completed');
  });

  worker.on('failed', async (job, err) => {
    if (!job) {
      logger.error({ err: err?.message }, 'provision_job_failed_no_job');
      return;
    }
    const remaining = (job.opts.attempts ?? 1) - job.attemptsMade;
    if (remaining > 0) {
      // BullMQ will retry; don't flip the DB to failed yet.
      logger.warn(
        { jobId: job.id, remaining, err: err?.message },
        'provision_job_failed_will_retry',
      );
      return;
    }
    logger.error(
      { jobId: job.id, err: err?.message },
      'provision_job_failed_terminal',
    );
    await markWorkspaceFailed(job.data.ownerUserId, classifyProvisioningError(err));
  });

  worker.on('error', (err) => {
    // Worker-level (not job-level) errors — connection drops, etc. Log only;
    // BullMQ reconnects automatically.
    logger.error({ err: err.message }, 'provision_worker_error');
  });

  cachedWorker = worker;
  return worker;
}

async function processProvisionJob(job: Job<ProvisionJobData>): Promise<void> {
  const { ownerUserId } = job.data;
  const attempt = job.attemptsMade + 1;
  // On any retry (attempt 2+), reset the workspace row so its
  // `provisioning_started_at` reflects this attempt — the UI's "overdue"
  // threshold is keyed off it, and stale timestamps would make a fresh
  // attempt look overdue from the start.
  if (attempt > 1 || job.data.manualRetry) {
    await resetWorkspaceProvisioningRow(ownerUserId);
  }
  // The bulk of the work — Docker, gbrain, OAuth, encrypted secret persist,
  // status='ready'. Throws on any failure; BullMQ converts that to retry-or-
  // permanent-failure based on attempts.
  await provisionTenant({ ownerUserId });
}

async function resetWorkspaceProvisioningRow(ownerUserId: string): Promise<void> {
  await db
    .update(schema.workspaces)
    .set({
      status: 'provisioning',
      lastError: null,
      provisioningStartedAt: new Date(),
    })
    .where(eq(schema.workspaces.ownerUserId, ownerUserId));
}

async function markWorkspaceFailed(
  ownerUserId: string,
  errorCode: string,
): Promise<void> {
  try {
    await db
      .update(schema.workspaces)
      .set({
        status: 'failed',
        lastError: errorCode,
      })
      .where(eq(schema.workspaces.ownerUserId, ownerUserId));
  } catch (err) {
    logger.error(
      { ownerUserId, err: err instanceof Error ? err.message : String(err) },
      'mark_workspace_failed_db_write_failed',
    );
  }
}

export async function stopProvisionWorker(): Promise<void> {
  if (cachedWorker) {
    await cachedWorker.close();
    cachedWorker = null;
  }
}
