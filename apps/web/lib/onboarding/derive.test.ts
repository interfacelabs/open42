import { describe, it, expect } from 'vitest';
import { deriveOnboardStep, deriveDashboardState } from './derive';

describe('deriveOnboardStep', () => {
  it('returns workspace when no workspace', () => {
    expect(deriveOnboardStep({ workspace: null } as any, null)).toBe('workspace');
  });
  it('returns workspace when workspace exists but URL says workspace (back-button)', () => {
    expect(deriveOnboardStep({ workspace: { id: 'x' } } as any, 'workspace')).toBe(
      'workspace',
    );
  });
  it('returns invite when URL says invite', () => {
    expect(deriveOnboardStep({ workspace: { id: 'x' } } as any, 'invite')).toBe('invite');
  });
  it('returns provisioning when URL says provisioning', () => {
    expect(
      deriveOnboardStep({ workspace: { id: 'x' } } as any, 'provisioning'),
    ).toBe('provisioning');
  });
  it('returns connect when URL says connect', () => {
    expect(deriveOnboardStep({ workspace: { id: 'x' } } as any, 'connect')).toBe('connect');
  });
  it('falls through to provisioning when runtime not ready', () => {
    expect(
      deriveOnboardStep(
        { workspace: { id: 'x', runtime: 'provisioning' }, connections: [] } as any,
        null,
      ),
    ).toBe('provisioning');
  });
  it('falls through to connect when ready but no connections', () => {
    expect(
      deriveOnboardStep(
        { workspace: { id: 'x', runtime: 'ready' }, connections: [] } as any,
        null,
      ),
    ).toBe('connect');
  });
  it('returns null when fully onboarded (ready + has connection)', () => {
    expect(
      deriveOnboardStep(
        { workspace: { id: 'x', runtime: 'ready' }, connections: [{}] } as any,
        null,
      ),
    ).toBeNull();
  });
});

describe('deriveDashboardState', () => {
  it('returns redirect-onboard when no workspace', () => {
    expect(deriveDashboardState({ workspace: null } as any).kind).toBe('redirect-onboard');
  });
  it('returns redirect-onboard when runtime not ready', () => {
    expect(
      deriveDashboardState({
        workspace: { id: 'x', runtime: 'provisioning' },
        connections: [],
        lastJob: null,
      } as any).kind,
    ).toBe('redirect-onboard');
  });
  it('returns ingesting when lastJob is queued or running', () => {
    expect(
      deriveDashboardState({
        workspace: { id: 'x', runtime: 'ready' },
        connections: [{}],
        lastJob: { status: 'queued' },
      } as any).kind,
    ).toBe('ingesting');
  });
  it('returns ready when ready + lastJob completed', () => {
    expect(
      deriveDashboardState({
        workspace: { id: 'x', runtime: 'ready' },
        connections: [{}],
        lastJob: { status: 'completed' },
      } as any).kind,
    ).toBe('ready');
  });
  it('returns ready when ready + no connections (post-skip dashboard)', () => {
    expect(
      deriveDashboardState({
        workspace: { id: 'x', runtime: 'ready' },
        connections: [],
        lastJob: null,
      } as any).kind,
    ).toBe('ready');
  });
  it('returns ready+error when lastJob.status=failed', () => {
    const s = deriveDashboardState({
      workspace: { id: 'x', runtime: 'ready' },
      connections: [{}],
      lastJob: { status: 'failed' },
    } as any);
    expect(s.kind).toBe('ready');
    expect((s as any).hasError).toBe(true);
  });
});
