import Link from 'next/link';
import { useRouter } from 'next/router';
import { ReactNode, useEffect } from 'react';
import useSWR from 'swr';
import { MessageSquarePlus, Plug, Sparkles, X } from 'lucide-react';

import WorkspaceSwitcher from '@/components/WorkspaceSwitcher';
import { fetcher, sourceKey, sourceLabel } from '@/lib/api';
import { useSidebarOpen } from '@/lib/useSidebarOpen';
import { cn } from '@/lib/utils';
import { useHydrateWorkspaceStore, useWorkspaceStore } from '@/lib/workspaces/store';

interface Connection {
  id: string;
  kind: string;
  displayName?: string | null;
  status: string;
}

interface CurrentResponse {
  user?: { id: string; email: string };
  connections?: Connection[];
}

interface SkillSummary {
  id: string;
  name: string;
  version: string | null;
}

interface SkillsListResponse {
  skills?: SkillSummary[];
}

const collections: { id: string; label: string }[] = [
  { id: 'recently-changed', label: 'Recently changed' },
  { id: 'most-cited', label: 'Most cited' },
  { id: 'stale', label: 'Stale (>90d)' },
  { id: 'untagged', label: 'Untagged' },
  { id: 'cited-in-skills', label: 'Cited in skills' },
];

/**
 * Workspace sidebar — calm, editorial, ~240px wide.
 *
 * Sections (top → bottom): Ask · Library · Sources · Skills · Status.
 * Footer holds the user pill (avatar + handle + version).
 */
export function Sidebar() {
  // Hydrate the workspace store exactly once per page load — the Sidebar is
  // the canonical authenticated chrome (mounted by dashboard, chat, library,
  // status, all settings pages), so this single call covers every screen
  // where the switcher and tenant-scoped fetches need a populated store.
  useHydrateWorkspaceStore();
  const router = useRouter();
  const { data } = useSWR<CurrentResponse>('/api/workspaces/current', fetcher);
  const connections = data?.connections ?? [];
  const email = data?.user?.email ?? null;
  // Skills list is workspace-scoped — the API rejects requests without an
  // explicit workspace_id in the path. The sidebar reads currentWorkspaceId
  // from the Zustand store; SWR sits idle on `null` until hydration.
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { data: skillsData } = useSWR<SkillsListResponse>(
    workspaceId ? `/api/workspaces/${encodeURIComponent(workspaceId)}/skills` : null,
    fetcher,
  );
  const skills = skillsData?.skills ?? [];

  const path = router.asPath ?? router.pathname ?? '';
  const isActive = (href: string): boolean =>
    path === href || path.startsWith(`${href}?`);

  const collectionParam = matchQueryParam(path, 'c');
  const sourceParam = matchQueryParam(path, 'source');

  const open = useSidebarOpen((s) => s.open);
  const setOpen = useSidebarOpen((s) => s.setOpen);

  // Close the drawer on route change (mobile only — on desktop it's static).
  useEffect(() => {
    const handler = () => setOpen(false);
    router.events.on('routeChangeStart', handler);
    return () => router.events.off('routeChangeStart', handler);
  }, [router.events, setOpen]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  return (
    <>
      {/* Mobile backdrop */}
      {open ? (
        <div
          role="presentation"
          aria-hidden="true"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-40 bg-text-primary/30 backdrop-blur-[2px] md:hidden"
        />
      ) : null}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex h-[100dvh] w-[260px] flex-col border-r border-border-soft bg-panel-soft transition-transform duration-200 ease-out',
          'md:sticky md:top-0 md:z-auto md:h-screen md:w-60 md:shrink-0 md:translate-x-0 md:transition-none',
          open ? 'translate-x-0 shadow-elevate' : '-translate-x-full md:shadow-none',
        )}
        aria-label="Workspace navigation"
      >
      <div className="flex items-center justify-between px-4 pb-3 pt-5">
        <Link
          href="/"
          className="flex items-center gap-2 font-mono text-[13px] font-medium text-text-primary transition-opacity hover:opacity-80"
        >
          <span
            aria-hidden="true"
            className="inline-block h-2 w-2 rounded-full bg-blue"
          />
          open42
        </Link>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close navigation"
          className="rounded-md p-1 text-text-faint transition-colors duration-140 hover:bg-white hover:text-text-primary md:hidden"
        >
          <X size={16} strokeWidth={1.6} />
        </button>
      </div>

      <div className="px-3 pb-1">
        <WorkspaceSwitcher />
      </div>

      <nav className="flex-1 overflow-auto px-2 pb-4 text-sm">
        <Section label="New">
          <Item
            href="/"
            active={isActive('/')}
            icon={<MessageSquarePlus size={14} strokeWidth={1.6} />}
          >
            New thread
          </Item>
        </Section>

        <Section label="Library">
          {collections.map((c) => (
            <Item
              key={c.id}
              href={`/library?c=${c.id}`}
              active={collectionParam === c.id && !sourceParam}
            >
              {c.label}
            </Item>
          ))}
        </Section>

        <Section label="Sources">
          {connections.map((c) => {
            const key = sourceKey(c.kind);
            return (
              <Item
                key={c.id}
                href={`/library?source=${key}`}
                active={sourceParam === key}
              >
                <span className="truncate">
                  {c.displayName ?? sourceLabel(c.kind)}
                </span>
              </Item>
            );
          })}
          <Item
            href="/settings/connections/add"
            icon={<Plug size={14} strokeWidth={1.6} />}
          >
            Connect
          </Item>
        </Section>

        <Section label="Skills">
          {skills.map((s) => (
            <Item
              key={s.id}
              href={`/chat?skill=${s.id}`}
              active={path.startsWith(`/chat?skill=${s.id}`)}
              icon={<Sparkles size={14} strokeWidth={1.6} />}
            >
              <span className="truncate">{s.name}</span>
            </Item>
          ))}
          <Item
            href="/chat"
            icon={<Sparkles size={14} strokeWidth={1.6} />}
          >
            New skill
          </Item>
        </Section>

        <Section label="Status">
          <Item href="/status" active={isActive('/status')}>
            <span className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="inline-block h-1.5 w-1.5 rounded-full bg-green"
              />
              All systems
            </span>
          </Item>
        </Section>
      </nav>

      <UserPill email={email} />
      </aside>
    </>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mb-3">
      <div className="px-2 pb-1.5 pt-3 font-mono text-[10px] uppercase tracking-[0.08em] text-text-faint">
        {label}
      </div>
      <div className="space-y-px">{children}</div>
    </div>
  );
}

function Item({
  href,
  active,
  icon,
  children,
}: {
  href: string;
  active?: boolean;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex h-8 items-center gap-2 rounded-md px-2 text-[13.5px] transition-colors duration-140',
        active
          ? 'bg-blue-soft text-blue'
          : 'text-text-body hover:bg-white hover:text-text-primary',
      )}
    >
      {icon ? (
        <span
          className={cn(
            'shrink-0 transition-colors',
            active ? 'text-blue' : 'text-text-faint',
          )}
        >
          {icon}
        </span>
      ) : null}
      <span className="flex flex-1 items-center gap-2 truncate">{children}</span>
    </Link>
  );
}

function UserPill({ email }: { email: string | null }) {
  const handle = email ? handleFromEmail(email) : '—';
  const initial = handle.charAt(0).toUpperCase();
  return (
    <div className="border-t border-border-soft p-3">
      <div className="flex items-center gap-2.5 rounded-md px-2 py-1.5">
        <span
          aria-hidden="true"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-text-primary text-[11px] font-medium text-white"
        >
          {initial}
        </span>
        <span className="flex flex-1 flex-col truncate">
          <span className="truncate text-[12.5px] font-medium leading-tight text-text-primary">
            {handle}
          </span>
          <span className="font-mono text-[10px] text-text-faint">v0.1</span>
        </span>
      </div>
    </div>
  );
}

function handleFromEmail(email: string): string {
  const local = email.split('@')[0] ?? email;
  return local.length > 22 ? `${local.slice(0, 22)}…` : local;
}

function matchQueryParam(path: string, name: string): string | null {
  const idx = path.indexOf('?');
  if (idx === -1) return null;
  const params = new URLSearchParams(path.slice(idx + 1));
  return params.get(name);
}
