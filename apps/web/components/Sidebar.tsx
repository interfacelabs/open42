import Link from 'next/link';
import { useRouter } from 'next/router';
import { ReactNode } from 'react';
import useSWR from 'swr';
import { MessageSquarePlus, Sparkles } from 'lucide-react';

import { fetcher, sourceKey, sourceLabel } from '@/lib/api';
import { cn } from '@/lib/utils';

interface Connection {
  id: string;
  kind: string;
  displayName?: string | null;
  status: string;
}

interface CurrentResponse {
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
 * Workspace sidebar — sectioned IA per `thoughts/2026-05-09/dashboard-redesign.md`.
 *
 * Sections (top → bottom): Ask · Curated · Sources · Skills · Status. The
 * Curated section's items are disabled until the Library route lands (P4).
 * Sources hydrate from `/api/workspaces/current`; SWR dedupes against home.
 */
export function Sidebar() {
  const router = useRouter();
  const { data } = useSWR<CurrentResponse>('/api/workspaces/current', fetcher);
  const connections = data?.connections ?? [];
  const { data: skillsData } = useSWR<SkillsListResponse>('/api/skills', fetcher);
  const skills = skillsData?.skills ?? [];

  const path = router.asPath ?? router.pathname ?? '';
  const isActive = (href: string): boolean =>
    path === href || path.startsWith(`${href}?`);

  const collectionParam = matchQueryParam(path, 'c');
  const sourceParam = matchQueryParam(path, 'source');

  return (
    <aside className="flex h-screen w-60 shrink-0 flex-col border-r border-border bg-white">
      <Link
        href="/"
        className="px-4 pb-2 pt-5 font-mono text-sm text-text-subtle transition-colors hover:text-text-primary"
      >
        open42
      </Link>

      <nav className="flex-1 overflow-auto px-2 pb-4 pt-3 text-sm">
        <Section label="Ask">
          <Item
            href="/"
            active={isActive('/')}
            icon={<MessageSquarePlus size={14} strokeWidth={1.5} />}
          >
            New thread
          </Item>
        </Section>

        <Section label="Curated">
          {collections.map((c) => (
            <Item
              key={c.id}
              href={`/auth/library?c=${c.id}`}
              active={collectionParam === c.id && !sourceParam}
            >
              {c.label}
            </Item>
          ))}
        </Section>

        <Section label="Sources">
          {connections.length === 0 ? (
            <DisabledItem hint="no sources yet">— none yet</DisabledItem>
          ) : (
            connections.map((c) => {
              const key = sourceKey(c.kind);
              return (
                <Item
                  key={c.id}
                  href={`/auth/library?source=${key}`}
                  active={sourceParam === key}
                >
                  <span className="truncate">
                    {c.displayName ?? sourceLabel(c.kind)}
                  </span>
                </Item>
              );
            })
          )}
          <Item href="/auth/settings/connections/add">+ Connect</Item>
        </Section>

        <Section label="Skills">
          {skills.length === 0 ? (
            <DisabledItem hint="skillify a chat thread to mint one">
              — none yet
            </DisabledItem>
          ) : (
            skills.map((s) => (
              <Item
                key={s.id}
                href={`/auth/chat?skill=${s.id}`}
                active={path.startsWith(`/auth/chat?skill=${s.id}`)}
                icon={<Sparkles size={14} strokeWidth={1.5} />}
              >
                <span className="truncate">{s.name}</span>
              </Item>
            ))
          )}
        </Section>

        <Section label="Status">
          <Item href="/auth/status" active={isActive('/auth/status')}>
            Status
          </Item>
        </Section>
      </nav>
    </aside>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mb-3">
      <div className="px-2 pb-1 pt-3 font-mono text-[10px] uppercase tracking-wider text-text-faint">
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
        'flex h-8 items-center gap-2 rounded-md px-2 transition-colors duration-140',
        active
          ? 'font-medium text-text-primary'
          : 'text-text-body hover:bg-secondary',
      )}
    >
      {icon ? <span className="shrink-0 opacity-60">{icon}</span> : null}
      <span className="flex flex-1 items-center gap-2 truncate">{children}</span>
    </Link>
  );
}

function DisabledItem({
  children,
  hint,
}: {
  children: ReactNode;
  hint?: string;
}) {
  return (
    <div
      aria-disabled="true"
      title={hint}
      className="flex h-8 cursor-not-allowed items-center gap-2 rounded-md px-2 text-text-faint"
    >
      <span className="flex flex-1 items-center gap-2 truncate">{children}</span>
    </div>
  );
}

function matchQueryParam(path: string, name: string): string | null {
  const idx = path.indexOf('?');
  if (idx === -1) return null;
  const params = new URLSearchParams(path.slice(idx + 1));
  return params.get(name);
}
