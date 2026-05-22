export const WORKSPACE_PLANS = ['starter', 'team', 'business'] as const;

export type WorkspacePlan = (typeof WORKSPACE_PLANS)[number];

export function normalizeWorkspacePlan(value: unknown): WorkspacePlan | null {
  if (value === 'free') return 'starter';
  if (value === 'paid') return 'team';
  return WORKSPACE_PLANS.includes(value as WorkspacePlan) ? (value as WorkspacePlan) : null;
}

export function workspacePlanRequiresBilling(plan: WorkspacePlan | null): boolean {
  return plan === 'team' || plan === 'business';
}
