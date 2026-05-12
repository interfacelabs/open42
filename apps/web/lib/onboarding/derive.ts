export type OnboardStep = 'workspace' | 'invite' | 'provisioning' | 'connect';

export type WorkspaceRuntime = 'provisioning' | 'overdue' | 'ready' | 'failed';

export type OnboardMode = 'first' | 'create';

export interface CurrentPayload {
  workspace: { id: string; name: string; runtime: WorkspaceRuntime } | null;
  connections: Array<unknown>;
  lastJob: { status: string } | null;
}

/**
 * Pick the onboarding step the user should see right now.
 *
 * - Honor an explicit `urlStep` (back-button, deep link, post-redirect handoff)
 *   so the URL is the source of truth for the rendered step.
 * - When no urlStep is set, fall through to the next undone step based on real
 *   state: workspace exists? runtime ready? at least one connection?
 * - Returns `null` when onboarding is fully complete — callers redirect to `/`.
 *
 * In `mode='create'` (the in-app "+ Create new workspace" flow), the page must
 * always show the workspace-name step regardless of any existing workspace,
 * because the user already has one and is explicitly creating another. The
 * only transition is to the provisioning step (via `?step=provisioning`) while
 * the newly-created workspace spins up; there is no invite/connect step.
 */
export function deriveOnboardStep(
  current: CurrentPayload,
  urlStep: string | null,
  mode: OnboardMode = 'first',
): OnboardStep | null {
  if (mode === 'create') {
    if (urlStep === 'provisioning') return 'provisioning';
    return 'workspace';
  }
  if (!current.workspace) return 'workspace';
  if (urlStep === 'workspace') return 'workspace';
  if (urlStep === 'invite') return 'invite';
  if (urlStep === 'provisioning') return 'provisioning';
  if (urlStep === 'connect') return 'connect';
  // No explicit step — derive from state.
  if (current.workspace.runtime !== 'ready') return 'provisioning';
  if (current.connections.length === 0) return 'connect';
  return null;
}

export type DashboardState =
  | { kind: 'redirect-sign-in' }
  | { kind: 'redirect-onboard' }
  | { kind: 'ingesting' }
  | { kind: 'ready'; hasError: boolean };

/**
 * State for the authenticated dashboard at `/`.
 *
 * The dashboard never shows the "connect a source" empty hero anymore — that
 * UI lives in `/onboard?step=connect`. By the time the user lands here,
 * either they've connected something or they explicitly skipped, and either
 * way the calm chat dashboard is the right surface.
 */
export function deriveDashboardState(current: CurrentPayload): DashboardState {
  if (!current.workspace) return { kind: 'redirect-onboard' };
  if (current.workspace.runtime !== 'ready') return { kind: 'redirect-onboard' };
  const status = current.lastJob?.status;
  if (status === 'queued' || status === 'running') return { kind: 'ingesting' };
  if (status === 'failed') return { kind: 'ready', hasError: true };
  return { kind: 'ready', hasError: false };
}

// Keep the old name as a deprecated alias so older callers/tests don't break
// before they migrate. Returns the same shape as deriveDashboardState minus
// the empty case (which no longer exists post-onboarding refactor).
export type HomeState = DashboardState;
export const deriveHomeState = deriveDashboardState;
