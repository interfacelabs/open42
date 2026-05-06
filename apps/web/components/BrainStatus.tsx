import Link from 'next/link';

import { Button } from './ui/button';

interface BrainStatusProps {
  pagesCount?: number;
  lastImported?: string | null;
  recentQueries?: string[];
  exportedSkills?: string[];
}

export function BrainStatus({
  pagesCount = 0,
  lastImported = null,
  recentQueries = [],
  exportedSkills = [],
}: BrainStatusProps) {
  return (
    <section>
      <p className="font-mono text-xs text-text-subtle">BRAIN STATUS</p>
      <h1 className="mt-4 text-4xl font-medium leading-headline tracking-tight text-text-primary md:text-5xl">
        {pagesCount > 0 ? 'Your brain is ready.' : 'Your brain is waiting for sources.'}
      </h1>
      <div className="mt-8 grid gap-4 md:grid-cols-3">
        <Metric label="Pages" value={String(pagesCount)} />
        <Metric label="Last imported" value={lastImported ?? 'never'} />
        <Metric label="Freshness" value={pagesCount > 0 ? 'current' : 'empty'} />
      </div>
      <div className="mt-8 flex flex-wrap gap-3">
        <Button asChild>
          <Link href="/auth/chat">Ask the brain</Link>
        </Button>
        <Button asChild variant="secondary">
          <Link href="/auth/onboard">Import Notion zip</Link>
        </Button>
      </div>
      <div className="mt-10 grid gap-6 md:grid-cols-2">
        <List title="Recent queries" empty="No queries yet." items={recentQueries} />
        <List title="Exported skills" empty="No skills exported yet." items={exportedSkills} />
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-white p-5">
      <p className="font-mono text-xs text-text-subtle">{label}</p>
      <p className="mt-3 text-2xl font-medium tracking-tight text-text-primary">{value}</p>
    </div>
  );
}

function List({ title, empty, items }: { title: string; empty: string; items: string[] }) {
  return (
    <div className="rounded-2xl border border-border bg-white p-5">
      <h2 className="text-base font-medium tracking-[-0.01em] text-text-primary">{title}</h2>
      <div className="mt-4 space-y-3">
        {items.length === 0 ? (
          <p className="text-sm text-text-subtle">{empty}</p>
        ) : (
          items.map((item) => (
            <p key={item} className="text-sm leading-body text-text-body">
              {item}
            </p>
          ))
        )}
      </div>
    </div>
  );
}
