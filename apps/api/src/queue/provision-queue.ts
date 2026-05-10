/**
 * BullMQ queue for tenant provisioning jobs.
 *
 * Why a queue at all: provisioning is a multi-step, multi-minute side-effect
 * job (Docker pull, container start, gbrain health-poll, OAuth registration,
 * encrypted secret persistence). Running it as `void provision(...)` in the
 * request handler — fire-and-forget over an in-process Promise — means any
 * crash between step 1 and step N leaves a half-provisioned workspace and
 * no recovery path. BullMQ persists the job in Redis, so process death just
 * means "another worker picks it up after the stalled-job timeout".
 *
 * Idempotency: the BullMQ jobId is the workspace owner's userId. Enqueueing
 * twice for the same owner is rejected by BullMQ (returns the existing job
 * unchanged). The provision worker itself is idempotent — see provision.ts
 * `provisionTenantResources` (docker rm -f before run, volume create is
 * no-op if exists, reserveWorkspaceForOwner returns existing row).
 *
 * Retries: 3 attempts with exponential backoff. Each attempt re-runs the
 * full provisioning function; partial state from a prior attempt (e.g. a
 * leftover container) is cleaned up by the worker before retry.
 *
 * State observability: workers update `workspaces.status` on transitions
 * (provisioning → ready/failed) so the existing `/api/workspaces/current`
 * surface stays unchanged. The DB column is the read-side cache; the queue
 * is the durable execution engine.
 */
import { Queue, type JobsOptions } from 'bullmq';

import { buildBullClient } from './connection.js';

export const PROVISION_QUEUE_NAME = 'tenant-provision';

export interface ProvisionJobData {
  workspaceId: string;
  ownerUserId: string;
  /** Set when the user explicitly hits retry, so we can distinguish from automatic retry. */
  manualRetry?: boolean;
}

let cachedQueue: Queue<ProvisionJobData> | null = null;

export function getProvisionQueue(): Queue<ProvisionJobData> {
  if (!cachedQueue) {
    cachedQueue = new Queue<ProvisionJobData>(PROVISION_QUEUE_NAME, {
      connection: buildBullClient(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 10_000 },
        // Keep finished job records around briefly for observability/debug
        // (e.g. retry-from-failed reads `getJob(jobId)`). BullMQ trims older
        // records automatically once these caps are hit.
        removeOnComplete: { age: 24 * 3600, count: 200 },
        removeOnFail: { age: 7 * 24 * 3600, count: 500 },
      },
    });
  }
  return cachedQueue;
}

/**
 * Enqueue a provisioning job. Uses `ownerUserId` as the BullMQ jobId so a
 * second enqueue for the same owner is a no-op (returns the existing job).
 *
 * If a prior job for this owner has already failed (no remaining attempts)
 * or completed, BullMQ rejects the duplicate ID — caller should call
 * `removeAndEnqueueProvisionJob` for an explicit retry from a terminal state.
 */
export async function enqueueProvisionJob(
  data: ProvisionJobData,
  options: JobsOptions = {},
): Promise<{ jobId: string; alreadyEnqueued: boolean }> {
  const queue = getProvisionQueue();
  const jobId = data.ownerUserId;
  const existing = await queue.getJob(jobId);
  if (existing) {
    return { jobId, alreadyEnqueued: true };
  }
  await queue.add('provision', data, { ...options, jobId });
  return { jobId, alreadyEnqueued: false };
}

/**
 * Drop any prior job (terminal or in-flight) for this owner and enqueue a
 * fresh one. Used by the explicit retry endpoint — the user has decided the
 * previous attempt is dead and wants to start over from scratch.
 */
export async function removeAndEnqueueProvisionJob(
  data: ProvisionJobData,
): Promise<{ jobId: string }> {
  const queue = getProvisionQueue();
  const jobId = data.ownerUserId;
  const existing = await queue.getJob(jobId);
  if (existing) {
    // remove() works for any state including active — BullMQ docs note that
    // active job removal will signal the worker to abort, but our worker is
    // mostly synchronous from BullMQ's POV (no long polling), so this is
    // best-effort and the worker will finish the current attempt naturally.
    await existing.remove().catch(() => undefined);
  }
  await queue.add('provision', { ...data, manualRetry: true }, { jobId });
  return { jobId };
}

export async function getProvisionJobState(
  ownerUserId: string,
): Promise<
  | {
      state: string;
      attemptsMade: number;
      attemptsTotal: number;
      failedReason: string | null;
      timestamp: number | null;
    }
  | null
> {
  const queue = getProvisionQueue();
  const job = await queue.getJob(ownerUserId);
  if (!job) return null;
  const state = await job.getState();
  return {
    state,
    attemptsMade: job.attemptsMade,
    attemptsTotal: (job.opts.attempts as number | undefined) ?? 1,
    failedReason: job.failedReason ?? null,
    timestamp: job.timestamp ?? null,
  };
}

export async function closeProvisionQueue(): Promise<void> {
  if (cachedQueue) {
    await cachedQueue.close();
    cachedQueue = null;
  }
}
