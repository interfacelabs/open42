import type { Citation } from './chat-types';

interface CitationDetailPaneProps {
  citation: Citation | null;
  onClose: () => void;
}

export function CitationDetailPane({ citation, onClose }: CitationDetailPaneProps) {
  return (
    <aside
      className={`h-screen shrink-0 overflow-hidden border-l border-border bg-white transition-all duration-200 ${
        citation ? 'w-[360px] translate-x-0' : 'w-0 translate-x-full'
      }`}
    >
      {citation ? (
        <div className="p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-mono text-xs text-text-subtle">CITATION [{citation.index}]</p>
              <h2 className="mt-3 text-xl font-medium tracking-tight text-text-primary">
                {citation.slug}
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full px-3 py-1 text-sm text-text-subtle transition-colors hover:bg-muted"
            >
              Close
            </button>
          </div>
          <dl className="mt-8 space-y-4 text-sm">
            <div>
              <dt className="font-mono text-xs text-text-subtle">Version</dt>
              <dd className="mt-1 text-text-body">{citation.version_id ?? 'unknown'}</dd>
            </div>
            <div>
              <dt className="font-mono text-xs text-text-subtle">Last updated</dt>
              <dd className="mt-1 text-text-body">{citation.last_updated ?? 'unknown'}</dd>
            </div>
            <div>
              <dt className="font-mono text-xs text-text-subtle">Excerpt</dt>
              <dd className="mt-2 rounded-2xl border border-border bg-muted p-4 leading-body text-text-body">
                {citation.excerpt || 'No excerpt returned.'}
              </dd>
            </div>
          </dl>
        </div>
      ) : null}
    </aside>
  );
}
