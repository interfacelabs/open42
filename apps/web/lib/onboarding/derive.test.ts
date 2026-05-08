import { describe, it, expect } from 'vitest';
import { deriveOnboardStep, deriveHomeState } from './derive';

describe('deriveOnboardStep', () => {
  it('returns workspace when no workspace', () => {
    expect(deriveOnboardStep({ workspace: null } as any, null)).toBe('workspace');
  });
  it('returns workspace when workspace exists but URL says workspace (back-button)', () => {
    expect(deriveOnboardStep({ workspace: { id: 'x' } } as any, 'workspace')).toBe('workspace');
  });
  it('returns invite when workspace exists and URL says invite or null', () => {
    expect(deriveOnboardStep({ workspace: { id: 'x' } } as any, null)).toBe('invite');
    expect(deriveOnboardStep({ workspace: { id: 'x' } } as any, 'invite')).toBe('invite');
  });
});

describe('deriveHomeState', () => {
  it('returns redirect-onboard when no workspace', () => {
    expect(deriveHomeState({ workspace: null } as any).kind).toBe('redirect-onboard');
  });
  it('returns empty when no connections + no lastJob', () => {
    expect(
      deriveHomeState({ workspace: { id: 'x' }, connections: [], lastJob: null } as any).kind,
    ).toBe('empty');
  });
  it('returns ingesting when lastJob is queued or running', () => {
    expect(
      deriveHomeState({
        workspace: { id: 'x' },
        connections: [{}],
        lastJob: { status: 'queued' },
      } as any).kind,
    ).toBe('ingesting');
    expect(
      deriveHomeState({
        workspace: { id: 'x' },
        connections: [{}],
        lastJob: { status: 'running' },
      } as any).kind,
    ).toBe('ingesting');
  });
  it('returns ready when lastJob.status=completed', () => {
    expect(
      deriveHomeState({
        workspace: { id: 'x' },
        connections: [{}],
        lastJob: { status: 'completed' },
      } as any).kind,
    ).toBe('ready');
  });
  it('returns ready+error when lastJob.status=failed', () => {
    const s = deriveHomeState({
      workspace: { id: 'x' },
      connections: [{}],
      lastJob: { status: 'failed' },
    } as any);
    expect(s.kind).toBe('ready');
    expect((s as any).hasError).toBe(true);
  });
});
