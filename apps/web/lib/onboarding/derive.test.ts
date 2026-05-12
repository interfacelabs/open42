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
  it('returns keys when URL says keys', () => {
    expect(deriveOnboardStep({ workspace: { id: 'x' } } as any, 'keys')).toBe('keys');
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
  it('falls through to keys when BYOK is required and provider keys are missing', () => {
    expect(
      deriveOnboardStep(
        {
          workspace: { id: 'x', runtime: 'ready' },
          connections: [],
          requiresProviderKeys: true,
          providerKeys: { anthropicChat: true, openaiEmbed: false },
        } as any,
        null,
      ),
    ).toBe('keys');
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

describe('deriveOnboardStep — mode=create', () => {
  it('returns workspace step regardless of existing workspace', () => {
    const current = {
      workspace: { id: 'w1', name: 'Existing', runtime: 'ready' as const },
      connections: [],
      lastJob: null,
    };
    expect(deriveOnboardStep(current, null, 'create')).toBe('workspace');
  });
  it('returns provisioning step when urlStep=provisioning', () => {
    const current = {
      workspace: { id: 'w1', name: 'Existing', runtime: 'ready' as const },
      connections: [],
      lastJob: null,
    };
    expect(deriveOnboardStep(current, 'provisioning', 'create')).toBe('provisioning');
  });
  it('ignores connections + connect step (no connect step in create mode)', () => {
    const current = {
      workspace: { id: 'w1', name: 'Existing', runtime: 'ready' as const },
      connections: [{}],
      lastJob: null,
    };
    expect(deriveOnboardStep(current, 'connect', 'create')).toBe('workspace');
  });
  it('returns workspace step even when current.workspace is null', () => {
    const current = { workspace: null, connections: [], lastJob: null };
    expect(deriveOnboardStep(current, null, 'create')).toBe('workspace');
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
