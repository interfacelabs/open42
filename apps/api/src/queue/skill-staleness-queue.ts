import { Queue } from 'bullmq';

import { buildBullClient } from './connection.js';

export const SKILL_STALENESS_QUEUE_NAME = 'skill-staleness';
export const SKILL_STALENESS_SWEEP_JOB_ID = 'skill-staleness-sweep';
export const SKILL_STALENESS_SWEEP_EVERY_MS = 20 * 60 * 1000;

export interface SkillStalenessJobData {
  workspaceId?: string;
}

let cachedQueue: Queue<SkillStalenessJobData> | null = null;

export function isB3Enabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.OPEN42_B3_ENABLED ?? env.open42_b3_enabled;
  if (raw === undefined || raw === '') return true;
  return !['0', 'false', 'off', 'no'].includes(raw.trim().toLowerCase());
}

export function getSkillStalenessQueue(): Queue<SkillStalenessJobData> {
  if (!cachedQueue) {
    cachedQueue = new Queue<SkillStalenessJobData>(SKILL_STALENESS_QUEUE_NAME, {
      connection: buildBullClient(),
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: { age: 24 * 3600, count: 100 },
        removeOnFail: { age: 7 * 24 * 3600, count: 200 },
      },
    });
  }
  return cachedQueue;
}

export async function scheduleSkillStalenessSweep(
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  if (!isB3Enabled(env)) return;
  await getSkillStalenessQueue().add(
    'sweep',
    {},
    {
      jobId: SKILL_STALENESS_SWEEP_JOB_ID,
      repeat: { every: SKILL_STALENESS_SWEEP_EVERY_MS },
    },
  );
}

export async function closeSkillStalenessQueue(): Promise<void> {
  if (cachedQueue) {
    await cachedQueue.close();
    cachedQueue = null;
  }
}
