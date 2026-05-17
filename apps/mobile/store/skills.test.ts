import { beforeEach, expect, it } from 'vitest';

import { useSkillsStore } from './skills';

beforeEach(() => {
  useSkillsStore.setState({ byWorkspace: {}, shareLinks: {} });
});

it('keeps skill lists isolated by workspace', () => {
  useSkillsStore.getState().setSkills('ws-1', [
    {
      id: 'skill-1',
      name: 'Refund policy',
      version: '1.0.0',
      updatedAt: '2026-05-17T00:00:00.000Z',
      staleness: null,
    },
  ]);
  useSkillsStore.getState().setSkills('ws-2', [
    {
      id: 'skill-2',
      name: 'Incident response',
      version: '1.2.0',
      updatedAt: '2026-05-16T00:00:00.000Z',
      staleness: {
        changelog: 'Pager policy changed.',
        detectedAt: '2026-05-17T00:00:00.000Z',
      },
    },
  ]);

  expect(useSkillsStore.getState().byWorkspace).toMatchObject({
    'ws-1': [{ id: 'skill-1', name: 'Refund policy' }],
    'ws-2': [{ id: 'skill-2', name: 'Incident response' }],
  });
});

it('caches share links and exposes remaining TTL for countdown UI', () => {
  useSkillsStore.getState().cacheShareLink('skill-1', {
    url: 'https://open42.test/shared/abc.zip',
    expiresAt: '2026-05-18T00:00:00.000Z',
  });

  expect(useSkillsStore.getState().shareLinks['skill-1']).toEqual({
    url: 'https://open42.test/shared/abc.zip',
    expiresAt: '2026-05-18T00:00:00.000Z',
  });
  expect(
    useSkillsStore
      .getState()
      .shareLinkRemainingMs('skill-1', new Date('2026-05-17T23:00:00.000Z').getTime())
  ).toBe(60 * 60 * 1000);
  expect(
    useSkillsStore
      .getState()
      .shareLinkRemainingMs('skill-1', new Date('2026-05-18T01:00:00.000Z').getTime())
  ).toBe(0);
  expect(useSkillsStore.getState().shareLinkRemainingMs('missing')).toBeNull();
});
