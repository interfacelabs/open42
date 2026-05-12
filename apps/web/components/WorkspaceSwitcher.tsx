import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { ChevronDown, Plus, Check } from 'lucide-react';

import { useWorkspaceStore } from '@/lib/workspaces/store';

/**
 * Top-of-chrome workspace switcher (D7). Groups workspaces by role
 * (owned vs joined), shows the active one with a checkmark, and offers
 * "Create new workspace" which routes into onboarding's `mode=create`
 * branch.
 *
 * Mounted inside `Sidebar.tsx` because the app has no top-bar yet — this
 * keeps the switcher visible on every authenticated page (sidebar isn't
 * rendered during /auth/onboard, which matches spec D7's "hidden during
 * onboarding" rule).
 */
export default function WorkspaceSwitcher() {
  const router = useRouter();
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const allowMultiWorkspace = useWorkspaceStore((s) => s.allowMultiWorkspace);
  const switchTo = useWorkspaceStore((s) => s.switchTo);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open]);

  const current = workspaces.find((w) => w.id === currentWorkspaceId);
  const owned = workspaces.filter((w) => w.role === 'owner');
  const joined = workspaces.filter((w) => w.role !== 'owner');

  const handleSwitch = async (id: string) => {
    setOpen(false);
    if (id === currentWorkspaceId) return;
    await switchTo(id);
    void router.push('/');
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-text-primary transition-colors hover:bg-secondary"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {current?.status === 'provisioning' && (
          <span className="font-mono text-[10px] uppercase tracking-wide text-text-subtle">
            provisioning…
          </span>
        )}
        <span className="flex-1 truncate text-left">
          {current?.name ?? 'Select workspace'}
        </span>
        <ChevronDown className="h-4 w-4 text-text-subtle" aria-hidden />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full z-20 mt-1 w-60 rounded-md border border-border bg-white shadow-lg"
        >
          {owned.length > 0 && (
            <div className="px-1 py-1">
              <p className="px-2 pt-1.5 pb-1 font-mono text-[10px] uppercase tracking-wide text-text-subtle">
                Workspaces you own
              </p>
              {owned.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm text-text-primary hover:bg-secondary"
                  onClick={() => void handleSwitch(w.id)}
                >
                  <span className="truncate">{w.name}</span>
                  {w.id === currentWorkspaceId && (
                    <Check className="h-4 w-4 text-accent" aria-hidden />
                  )}
                </button>
              ))}
            </div>
          )}
          {joined.length > 0 && (
            <div className="border-t border-border px-1 py-1">
              <p className="px-2 pt-1.5 pb-1 font-mono text-[10px] uppercase tracking-wide text-text-subtle">
                Workspaces you&rsquo;ve joined
              </p>
              {joined.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm text-text-primary hover:bg-secondary"
                  onClick={() => void handleSwitch(w.id)}
                >
                  <span className="truncate">{w.name}</span>
                  {w.id === currentWorkspaceId && (
                    <Check className="h-4 w-4 text-accent" aria-hidden />
                  )}
                </button>
              ))}
            </div>
          )}
          {allowMultiWorkspace ? (
            <div className="border-t border-border px-1 py-1">
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-text-primary hover:bg-secondary"
                onClick={() => {
                  setOpen(false);
                  void router.push('/auth/onboard?mode=create');
                }}
              >
                <Plus className="h-4 w-4" aria-hidden />
                Create new workspace
              </button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
