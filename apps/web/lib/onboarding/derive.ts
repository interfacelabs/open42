export type OnboardStep = 'workspace' | 'invite';

export interface CurrentPayload {
  workspace: { id: string; name: string; runtime: 'pending' | 'ready' | 'failed' } | null;
  connections: Array<unknown>;
  lastJob: { status: string } | null;
}

export function deriveOnboardStep(
  current: CurrentPayload,
  urlStep: string | null,
): OnboardStep {
  if (!current.workspace) return 'workspace';
  if (urlStep === 'workspace') return 'workspace';
  return 'invite';
}

export type HomeState =
  | { kind: 'redirect-onboard' }
  | { kind: 'empty' }
  | { kind: 'ingesting' }
  | { kind: 'ready'; hasError: boolean };

export function deriveHomeState(current: CurrentPayload): HomeState {
  if (!current.workspace) return { kind: 'redirect-onboard' };
  if (current.connections.length === 0 && !current.lastJob) return { kind: 'empty' };
  const status = current.lastJob?.status;
  if (status === 'queued' || status === 'running') return { kind: 'ingesting' };
  if (status === 'failed') return { kind: 'ready', hasError: true };
  return { kind: 'ready', hasError: false };
}
