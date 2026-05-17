import { describe, expect, it, vi } from 'vitest';

import { citedTextSha256 } from '../skills/provenance.js';
import { isB3Enabled } from './skill-staleness-queue.js';
import {
  runSkillStalenessSweep,
  type SkillStalenessRepo,
  type StalenessCandidate,
} from './skill-staleness-worker.js';

const baseCandidate: StalenessCandidate = {
  workspaceId: 'workspace-1',
  skillId: 'skill-1',
  skillVersionId: 'version-1',
  citationIndex: 1,
  slug: 'refund-policy',
  previousVersionId: '1',
  previousCitedText: 'Annual customers have thirty days.',
  previousCitedTextSha256: citedTextSha256('Annual customers have thirty days.'),
};

describe('isB3Enabled', () => {
  it('defaults on and accepts false-like opt-outs', () => {
    expect(isB3Enabled({} as NodeJS.ProcessEnv)).toBe(true);
    expect(isB3Enabled({ OPEN42_B3_ENABLED: 'false' } as NodeJS.ProcessEnv)).toBe(false);
    expect(isB3Enabled({ open42_b3_enabled: '0' } as NodeJS.ProcessEnv)).toBe(false);
    expect(isB3Enabled({ OPEN42_B3_ENABLED: 'true' } as NodeJS.ProcessEnv)).toBe(true);
  });
});

describe('runSkillStalenessSweep', () => {
  it('records stale cited spans with a cached changelog when hashes change', async () => {
    const staleWrites: unknown[] = [];
    const repo = fakeRepo([baseCandidate], { staleWrites });
    const generateChangelog = vi.fn(async () => 'Refund window changed to fourteen days.');

    const result = await runSkillStalenessSweep(
      {},
      {
        repo,
        buildGbrain: async () => ({
          getChunks: async () => [
            {
              slug: 'refund-policy',
              version_id: 2,
              chunk_text: 'Annual customers have fourteen days.',
            },
          ],
        }),
        resolveLlmKey: async () => ({
          apiKey: 'sk-ant-test',
          source: 'tenant',
          model: 'claude-haiku-test',
        }),
        generateChangelog,
        now: () => new Date('2026-05-17T05:00:00.000Z'),
      },
    );

    expect(result).toEqual({ checked: 1, stale: 1, resolved: 0 });
    expect(generateChangelog).toHaveBeenCalledWith({
      slug: 'refund-policy',
      previousText: 'Annual customers have thirty days.',
      latestText: 'Annual customers have fourteen days.',
      resolvedAnthropic: {
        apiKey: 'sk-ant-test',
        source: 'tenant',
        model: 'claude-haiku-test',
      },
    });
    expect(staleWrites[0]).toMatchObject({
      skillVersionId: 'version-1',
      citationIndex: 1,
      slug: 'refund-policy',
      latestVersionId: '2',
      changelog: 'Refund window changed to fourteen days.',
      detectedAt: new Date('2026-05-17T05:00:00.000Z'),
    });
  });

  it('resolves existing stale rows when the cited span hash matches again', async () => {
    const resolvedWrites: unknown[] = [];
    const repo = fakeRepo([baseCandidate], { resolvedWrites });

    const result = await runSkillStalenessSweep(
      {},
      {
        repo,
        buildGbrain: async () => ({
          getChunks: async () => [
            {
              slug: 'refund-policy',
              version_id: 1,
              chunk_text: 'Annual customers have thirty days.',
            },
          ],
        }),
        resolveLlmKey: async () => null,
        now: () => new Date('2026-05-17T05:10:00.000Z'),
      },
    );

    expect(result).toEqual({ checked: 1, stale: 0, resolved: 1 });
    expect(resolvedWrites[0]).toEqual({
      skillVersionId: 'version-1',
      citationIndex: 1,
      resolvedAt: new Date('2026-05-17T05:10:00.000Z'),
    });
  });
});

function fakeRepo(
  candidates: StalenessCandidate[],
  writes: { staleWrites?: unknown[]; resolvedWrites?: unknown[] },
): SkillStalenessRepo {
  return {
    async listCandidates() {
      return candidates;
    },
    async markResolved(input) {
      writes.resolvedWrites?.push(input);
    },
    async upsertStale(input) {
      writes.staleWrites?.push(input);
    },
  };
}
