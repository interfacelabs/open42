/**
 * Empty state shown when /members returns 403 — the caller is no longer a
 * member (kicked, or cookie pointed at a workspace they lost access to).
 * The page-level effect runs the workspace recovery flow in parallel.
 */
export function AccessDenied() {
  return (
    <div
      role="alert"
      data-testid="members-access-denied"
      className="mt-8 rounded-lg border border-input bg-secondary px-4 py-3 text-sm text-text-body"
    >
      You don&rsquo;t have access to this workspace. Switching you to another
      workspace&hellip;
    </div>
  );
}
