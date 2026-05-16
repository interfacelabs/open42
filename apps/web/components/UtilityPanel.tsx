import Link from 'next/link';
import useSWR from 'swr';
import {
  ArrowUpRight,
  MessageSquare,
  PanelRightClose,
  Plug,
  Plug2,
  Upload,
} from 'lucide-react';

import { fetcher, formatRelative } from '@/lib/api';
import { useUtilityPanelVisible } from '@/lib/useUtilityPanelVisible';
import { cn } from '@/lib/utils';

interface JobSummary {
  status?: string;
  pagesTotal?: number | null;
  pagesIndexed?: number | null;
  createdAt?: string;
}

interface WorkspaceSummary {
  id: string;
  runtime: string;
}

interface CurrentResponse {
  workspace: WorkspaceSummary | null;
  connections?: Array<{ id: string; kind: string; status: string }>;
  lastJob?: JobSummary | null;
}

/**
 * Right-rail utility panel.
 *
 * Three blocks, top to bottom:
 *   1. Brain status — derived from /api/workspaces/current (job + connections)
 *   2. Quick actions — Ask, Upload, Manage connections
 *   3. Editorial quote — anchor for the brand voice
 *
 * Renders inside an existing main + sidebar layout. The panel is fixed-width
 * (~300px) on `lg` and hidden below. Pages should wrap with a flex container.
 */
export function UtilityPanel({ className }: { className?: string }) {
  const { data } = useSWR<CurrentResponse>('/api/workspaces/current', fetcher);
  const { visible, setVisible } = useUtilityPanelVisible();
  const status = deriveBrainStatus(data ?? null);

  if (!visible) return null;

  return (
    <aside
      className={cn(
        'hidden w-[300px] shrink-0 flex-col gap-5 border-l border-border-soft bg-panel px-5 py-7 lg:flex',
        className,
      )}
      aria-label="Workspace utilities"
    >
      <div className="-mt-1 flex items-center justify-between">
        <p className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-text-faint">
          Workspace
        </p>
        <button
          type="button"
          onClick={() => setVisible(false)}
          aria-label="Hide workspace panel"
          title="Hide panel"
          className="-mr-1 rounded-md p-1 text-text-faint transition-colors duration-140 hover:bg-panel-soft hover:text-text-primary"
        >
          <PanelRightClose size={14} strokeWidth={1.6} />
        </button>
      </div>
      <BrainStatusCard status={status} />
      <QuickActionsCard />
      <QuoteCard />
    </aside>
  );
}

/* ─────────────────────────── Brain status ─────────────────────────── */

type BrainStatus =
  | { kind: 'loading' }
  | { kind: 'empty' }
  | {
      kind: 'ready';
      pages: number;
      lastSynced: string | null;
    }
  | {
      kind: 'indexing';
      indexed: number | null;
      total: number | null;
      pct: number | null;
    }
  | { kind: 'error' };

function deriveBrainStatus(data: CurrentResponse | null): BrainStatus {
  if (!data) return { kind: 'loading' };
  if (!data.workspace) return { kind: 'empty' };
  const job = data.lastJob ?? null;
  if (!job) {
    return {
      kind: 'ready',
      pages: 0,
      lastSynced: null,
    };
  }
  if (job.status === 'failed') return { kind: 'error' };
  if (job.status === 'queued' || job.status === 'running') {
    const total = job.pagesTotal ?? null;
    const indexed = job.pagesIndexed ?? null;
    const pct =
      total && total > 0 && indexed != null
        ? Math.min(100, Math.max(0, Math.round((indexed / total) * 100)))
        : null;
    return { kind: 'indexing', indexed, total, pct };
  }
  return {
    kind: 'ready',
    pages: job.pagesTotal ?? 0,
    lastSynced: job.createdAt ? formatRelative(job.createdAt) : null,
  };
}

function BrainStatusCard({ status }: { status: BrainStatus }) {
  return (
    <section>
      <div className="flex items-center justify-between">
        <h3 className="text-[13px] font-medium text-text-primary">Brain status</h3>
        <DotForStatus status={status} />
      </div>
      <div className="mt-3">
        <StatusBar status={status} />
        <p className="mt-2 font-mono text-[10.5px] text-text-subtle">
          {labelForStatus(status)}
        </p>
      </div>
    </section>
  );
}

function DotForStatus({ status }: { status: BrainStatus }) {
  if (status.kind === 'error') {
    return <span className="inline-block h-1.5 w-1.5 rounded-full bg-destructive" />;
  }
  if (status.kind === 'indexing' || status.kind === 'loading') {
    return (
      <span
        className="inline-block h-1.5 w-1.5 rounded-full bg-blue"
        style={{ animation: 'pulse 1.4s ease-in-out infinite' }}
      />
    );
  }
  if (status.kind === 'ready') {
    return <span className="inline-block h-1.5 w-1.5 rounded-full bg-green" />;
  }
  return <span className="inline-block h-1.5 w-1.5 rounded-full bg-text-faint" />;
}

function StatusBar({ status }: { status: BrainStatus }) {
  let pct: number | null = null;
  let indeterminate = false;
  let color = 'bg-blue';
  if (status.kind === 'ready') {
    pct = 100;
    color = 'bg-green';
  } else if (status.kind === 'indexing') {
    pct = status.pct;
    indeterminate = pct === null;
  } else if (status.kind === 'error') {
    pct = 100;
    color = 'bg-destructive';
  } else {
    pct = 8;
    color = 'bg-text-faint';
  }
  return (
    <div className="relative h-1 overflow-hidden rounded-full bg-blue-soft">
      <div
        className={cn('h-full rounded-full transition-[width] duration-500', color)}
        style={{ width: `${pct ?? 0}%` }}
      />
      {indeterminate ? (
        <div
          className="pointer-events-none absolute left-0 top-0 h-full w-[60px] bg-gradient-to-r from-transparent via-white/75 to-transparent"
          style={{ animation: 'shimmer 1.6s linear infinite' }}
          aria-hidden="true"
        />
      ) : null}
    </div>
  );
}

function labelForStatus(status: BrainStatus): string {
  switch (status.kind) {
    case 'loading':
      return 'Checking status…';
    case 'empty':
      return 'No workspace yet.';
    case 'indexing': {
      if (status.indexed != null && status.total != null) {
        return `Indexing ${status.indexed.toLocaleString()} / ${status.total.toLocaleString()} pages`;
      }
      return 'Indexing your sources…';
    }
    case 'ready':
      if (status.pages > 0) {
        return status.lastSynced
          ? `${status.pages.toLocaleString()} pages · synced ${status.lastSynced}`
          : `${status.pages.toLocaleString()} pages indexed`;
      }
      return 'Ready. Connect a source to begin.';
    case 'error':
      return 'Couldn\u2019t finish indexing.';
  }
}

/* ─────────────────────────── Quick actions ─────────────────────────── */

const QUICK_ACTIONS: Array<{
  href: string;
  label: string;
  sub: string;
  icon: React.ReactNode;
}> = [
  {
    href: '/chat',
    label: 'Ask the brain',
    sub: 'Get a cited answer',
    icon: <MessageSquare size={14} strokeWidth={1.6} />,
  },
  {
    href: '/settings/ingest',
    label: 'Upload a source',
    sub: 'PDF, Notion, Drive…',
    icon: <Upload size={14} strokeWidth={1.6} />,
  },
  {
    href: '/settings/connections',
    label: 'Manage connections',
    sub: 'Tokens, scopes, refresh',
    icon: <Plug size={14} strokeWidth={1.6} />,
  },
  {
    href: '/settings/mcp',
    label: 'Connect AI tools',
    sub: 'Create MCP credentials for Claude Code and other MCP clients.',
    icon: <Plug2 size={14} strokeWidth={1.6} />,
  },
];

function QuickActionsCard() {
  return (
    <section>
      <h3 className="text-[13px] font-medium text-text-primary">Quick actions</h3>
      <div className="mt-3 flex flex-col gap-1">
        {QUICK_ACTIONS.map((a) => (
          <Link
            key={a.href}
            href={a.href}
            className="group flex items-center gap-3 rounded-lg px-2 py-2 transition-colors duration-140 hover:bg-panel-soft"
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border-soft bg-white text-text-body group-hover:text-text-primary">
              {a.icon}
            </span>
            <span className="flex flex-1 flex-col">
              <span className="text-[13px] font-medium leading-tight text-text-primary">
                {a.label}
              </span>
              <span className="text-[11.5px] leading-tight text-text-subtle">
                {a.sub}
              </span>
            </span>
            <ArrowUpRight
              size={13}
              strokeWidth={1.6}
              className="shrink-0 text-text-faint transition-colors group-hover:text-text-primary"
            />
          </Link>
        ))}
      </div>
    </section>
  );
}

/* ─────────────────────────── Editorial quote ─────────────────────────── */

function QuoteCard() {
  return (
    <section className="mt-auto rounded-xl border border-border-soft bg-panel-blue p-4">
      <p className="text-[13px] leading-snug text-text-primary">
        The more it{' '}
        <span className="font-serif italic">knows</span>, the smarter it gets.
      </p>
      <p className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-text-faint">
        open42 · operating principle
      </p>
    </section>
  );
}
