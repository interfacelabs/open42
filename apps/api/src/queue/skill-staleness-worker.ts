import { Worker, type Job } from 'bullmq';
import { and, eq } from 'drizzle-orm';
import pino from 'pino';

import { resolveLlmKey, type ResolvedLlmKey } from '../auth/llm-keys.js';
import { db as defaultDb, schema } from '../db/client.js';
import { buildGbrainForWorkspace } from '../gbrain/factory.js';
import type { GbrainClient } from '../gbrain/client.js';
import { fallbackSkillChangelog, generateSkillChangelog } from '../skills/changelog.js';
import {
  citedTextFromChunks,
  citedTextSha256,
  latestVersionIdFromChunks,
} from '../skills/provenance.js';
import { buildBullSubscriber } from './connection.js';
import {
  isB3Enabled,
  SKILL_STALENESS_QUEUE_NAME,
  type SkillStalenessJobData,
} from './skill-staleness-queue.js';

const logger = pino({ name: 'skill-staleness-worker' });

export interface StalenessCandidate {
  workspaceId: string;
  skillId: string;
  skillVersionId: string;
  citationIndex: number;
  slug: string;
  previousVersionId: string | null;
  previousCitedText: string;
  previousCitedTextSha256: string;
}

export interface SkillStalenessRepo {
  listCandidates(workspaceId?: string): Promise<StalenessCandidate[]>;
  markResolved(input: {
    skillVersionId: string;
    citationIndex: number;
    resolvedAt: Date;
  }): Promise<void>;
  upsertStale(input: {
    workspaceId: string;
    skillId: string;
    skillVersionId: string;
    citationIndex: number;
    slug: string;
    previousVersionId: string | null;
    latestVersionId: string | null;
    previousCitedTextSha256: string;
    latestCitedTextSha256: string;
    changelog: string;
    detectedAt: Date;
  }): Promise<void>;
}

export interface RunSkillStalenessSweepDeps {
  repo?: SkillStalenessRepo;
  buildGbrain?: (workspaceId: string) => Promise<Pick<GbrainClient, 'getChunks'>>;
  resolveLlmKey?: typeof resolveLlmKey;
  generateChangelog?: typeof generateSkillChangelog;
  now?: () => Date;
}

export interface RunSkillStalenessSweepResult {
  checked: number;
  stale: number;
  resolved: number;
}

let cachedWorker: Worker<SkillStalenessJobData> | null = null;

export function startSkillStalenessWorker(
  env: NodeJS.ProcessEnv = process.env,
): Worker<SkillStalenessJobData> | null {
  if (!isB3Enabled(env)) return null;
  if (cachedWorker) return cachedWorker;

  const worker = new Worker<SkillStalenessJobData>(
    SKILL_STALENESS_QUEUE_NAME,
    async (job) => processSkillStalenessJob(job),
    {
      connection: buildBullSubscriber(),
      concurrency: 1,
    },
  );

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id }, 'skill_staleness_job_completed');
  });
  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err: err.message }, 'skill_staleness_job_failed');
  });
  worker.on('error', (err) => {
    logger.error({ err: err.message }, 'skill_staleness_worker_error');
  });

  cachedWorker = worker;
  return worker;
}

export async function stopSkillStalenessWorker(): Promise<void> {
  if (cachedWorker) {
    await cachedWorker.close();
    cachedWorker = null;
  }
}

export async function processSkillStalenessJob(
  job: Pick<Job<SkillStalenessJobData>, 'data'>,
): Promise<RunSkillStalenessSweepResult> {
  return runSkillStalenessSweep({ workspaceId: job.data.workspaceId });
}

export async function runSkillStalenessSweep(
  options: { workspaceId?: string } = {},
  deps: RunSkillStalenessSweepDeps = {},
): Promise<RunSkillStalenessSweepResult> {
  const repo = deps.repo ?? defaultRepo();
  const buildGbrain = deps.buildGbrain ?? buildGbrainForWorkspace;
  const resolveKey = deps.resolveLlmKey ?? resolveLlmKey;
  const generateChangelog = deps.generateChangelog ?? generateSkillChangelog;
  const now = deps.now ?? (() => new Date());
  const candidates = await repo.listCandidates(options.workspaceId);
  const gbrains = new Map<string, Pick<GbrainClient, 'getChunks'>>();
  const llmKeys = new Map<string, ResolvedLlmKey | null>();
  let stale = 0;
  let resolved = 0;

  for (const candidate of candidates) {
    let gbrain = gbrains.get(candidate.workspaceId);
    if (!gbrain) {
      gbrain = await buildGbrain(candidate.workspaceId);
      gbrains.set(candidate.workspaceId, gbrain);
    }
    const chunks = await gbrain.getChunks(candidate.slug);
    const latestCitedText = citedTextFromChunks(chunks);
    if (!latestCitedText) continue;

    const latestHash = citedTextSha256(latestCitedText);
    if (latestHash === candidate.previousCitedTextSha256) {
      await repo.markResolved({
        skillVersionId: candidate.skillVersionId,
        citationIndex: candidate.citationIndex,
        resolvedAt: now(),
      });
      resolved += 1;
      continue;
    }

    let resolvedKey = llmKeys.get(candidate.workspaceId);
    if (!llmKeys.has(candidate.workspaceId)) {
      resolvedKey = await resolveKey({
        workspaceId: candidate.workspaceId,
        provider: 'anthropic',
        scope: 'chat',
      }).catch(() => null);
      llmKeys.set(candidate.workspaceId, resolvedKey ?? null);
    }
    const changelog = resolvedKey
      ? await generateChangelog({
          slug: candidate.slug,
          previousText: candidate.previousCitedText,
          latestText: latestCitedText,
          resolvedAnthropic: resolvedKey,
        }).catch(() => null)
      : null;

    await repo.upsertStale({
      workspaceId: candidate.workspaceId,
      skillId: candidate.skillId,
      skillVersionId: candidate.skillVersionId,
      citationIndex: candidate.citationIndex,
      slug: candidate.slug,
      previousVersionId: candidate.previousVersionId,
      latestVersionId: latestVersionIdFromChunks(chunks),
      previousCitedTextSha256: candidate.previousCitedTextSha256,
      latestCitedTextSha256: latestHash,
      changelog: changelog ?? fallbackSkillChangelog(candidate.slug),
      detectedAt: now(),
    });
    stale += 1;
  }

  return { checked: candidates.length, stale, resolved };
}

function defaultRepo(): SkillStalenessRepo {
  return {
    async listCandidates(workspaceId) {
      const where = workspaceId ? eq(schema.skills.workspaceId, workspaceId) : undefined;
      const rows = await defaultDb
        .select({
          workspaceId: schema.skills.workspaceId,
          skillId: schema.skills.id,
          skillVersionId: schema.skillCitationProvenance.skillVersionId,
          citationIndex: schema.skillCitationProvenance.citationIndex,
          slug: schema.skillCitationProvenance.slug,
          previousVersionId: schema.skillCitationProvenance.versionId,
          previousCitedText: schema.skillCitationProvenance.citedText,
          previousCitedTextSha256: schema.skillCitationProvenance.citedTextSha256,
        })
        .from(schema.skillCitationProvenance)
        .innerJoin(
          schema.skillVersions,
          eq(schema.skillVersions.id, schema.skillCitationProvenance.skillVersionId),
        )
        .innerJoin(schema.skills, eq(schema.skills.id, schema.skillVersions.skillId))
        .where(where);

      return rows;
    },
    async markResolved(input) {
      await defaultDb
        .update(schema.skillStaleness)
        .set({ status: 'resolved', resolvedAt: input.resolvedAt })
        .where(
          and(
            eq(schema.skillStaleness.skillVersionId, input.skillVersionId),
            eq(schema.skillStaleness.citationIndex, input.citationIndex),
            eq(schema.skillStaleness.status, 'stale'),
          ),
        );
    },
    async upsertStale(input) {
      const [existing] = await defaultDb
        .select({ id: schema.skillStaleness.id })
        .from(schema.skillStaleness)
        .where(
          and(
            eq(schema.skillStaleness.skillVersionId, input.skillVersionId),
            eq(schema.skillStaleness.citationIndex, input.citationIndex),
            eq(schema.skillStaleness.status, 'stale'),
          ),
        )
        .limit(1);
      const values = {
        latestVersionId: input.latestVersionId,
        latestCitedTextSha256: input.latestCitedTextSha256,
        changelog: input.changelog,
        detectedAt: input.detectedAt,
        resolvedAt: null,
      };
      if (existing) {
        await defaultDb
          .update(schema.skillStaleness)
          .set(values)
          .where(eq(schema.skillStaleness.id, existing.id));
        return;
      }
      await defaultDb.insert(schema.skillStaleness).values({
        workspaceId: input.workspaceId,
        skillId: input.skillId,
        skillVersionId: input.skillVersionId,
        citationIndex: input.citationIndex,
        slug: input.slug,
        previousVersionId: input.previousVersionId,
        latestVersionId: input.latestVersionId,
        previousCitedTextSha256: input.previousCitedTextSha256,
        latestCitedTextSha256: input.latestCitedTextSha256,
        changelog: input.changelog,
        status: 'stale',
        detectedAt: input.detectedAt,
      });
    },
  };
}
