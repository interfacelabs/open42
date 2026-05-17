import { Download } from 'lucide-react';
import { FormEvent, useState } from 'react';
import useSWR from 'swr';

import {
  PostExportDialog,
  type PostExportReceipt,
  type ShareLinkResult,
} from '@/components/PostExportDialog';
import { SlideOver } from '@/components/SlideOver';
import { Button } from '@/components/ui/button';
import { fetcher, type FetchError } from '@/lib/api';
import { csrfHeaders } from '@/lib/csrf';
import type { SkillDraft, SkillRevision } from '@/lib/skill-types';
import { cn } from '@/lib/utils';
import { useWorkspaceStore } from '@/lib/workspaces/store';

interface SkillPanelProps {
  draftId: string | null;
  onClose: () => void;
}

/**
 * SK-B v5 from the 2026-05-09 dashboard design — slide-over panel with
 * chat-left + skill-right. Iteration happens via the composer at the bottom of
 * the chat column; the right column shows the live preview.
 *
 * Composer is currently local-only (revisions append to React state, no server
 * round-trip). Real drafting is wired in P6c.
 */
export function SkillPanel({ draftId, onClose }: SkillPanelProps) {
  // The skill draft endpoint is workspace-scoped (`/workspaces/:id/skills/...`).
  // Read the workspace id from the Zustand store; SWR stays idle until both
  // draftId and workspaceId are known.
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const workspaceName = useWorkspaceStore((s) => {
    const id = s.currentWorkspaceId;
    return s.workspaces.find((workspace) => workspace.id === id)?.name ?? null;
  });
  const draftUrl =
    draftId && workspaceId
      ? `/api/workspaces/${encodeURIComponent(workspaceId)}/skills/${encodeURIComponent(draftId)}/draft`
      : null;
  const { data, isLoading, error, mutate } = useSWR<{ draft: SkillDraft }, FetchError>(
    draftUrl,
    fetcher,
  );
  const draft = data?.draft ?? null;

  return (
    <SlideOver
      open={!!draftId}
      onClose={onClose}
      width="lg"
      ariaLabel={draft?.name ?? 'Skill draft'}
    >
      {error ? (
        <ErrorState onClose={onClose} />
      ) : !draft ? (
        <LoadingState loading={isLoading} />
      ) : (
        // Keyed on draft.id so reopening with a different draft resets the
        // local revisions state cleanly (no stale composer entries).
        <PanelBody
          key={draft.id}
          draft={draft}
          workspaceId={workspaceId}
          workspaceName={workspaceName}
          mutateDraft={mutate}
          onClose={onClose}
        />
      )}
    </SlideOver>
  );
}

function PanelBody({
  draft,
  workspaceId,
  workspaceName,
  mutateDraft,
  onClose,
}: {
  draft: SkillDraft;
  workspaceId: string | null;
  workspaceName: string | null;
  mutateDraft: () => Promise<unknown>;
  onClose: () => void;
}) {
  // Optimistic 'you' revision shown until the POST returns the next version.
  // The brain's reply is the new revision row server-side; SWR re-pulls.
  const [pendingYou, setPendingYou] = useState<SkillRevision | null>(null);
  const [revising, setRevising] = useState(false);
  const [reviseError, setReviseError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportReceipt, setExportReceipt] = useState<PostExportReceipt>({
    status: 'signing_in_progress',
    workspaceName,
    sourceCount: draft.cites.length,
    version: draft.version,
    staleAtExport: draft.staleness ? { changelog: draft.staleness.changelog } : null,
    explainerStatus: 'pending',
  });

  async function onRevise(text: string) {
    if (!text.trim() || revising) return;
    if (!workspaceId) {
      setReviseError('no_active_workspace');
      return;
    }
    const optimistic: SkillRevision = {
      id: `pending-${Date.now()}`,
      role: 'you',
      text: text.trim(),
    };
    setPendingYou(optimistic);
    setReviseError(null);
    setRevising(true);
    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceId)}/skills/${encodeURIComponent(draft.id)}/revise`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
          body: JSON.stringify({ text: text.trim() }),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        draft?: SkillDraft;
        error?: string;
      };
      if (!response.ok || !payload.draft) {
        setReviseError(payload.error ?? 'revise_failed');
        return;
      }
      // The server-side POST already wrote the user's revision row + a brain
      // revision row. Re-pull the canonical draft so the chat column matches.
      await mutateDraft();
    } catch {
      setReviseError('network_error');
    } finally {
      setPendingYou(null);
      setRevising(false);
    }
  }

  const allRevisions = pendingYou ? [...draft.revisions, pendingYou] : draft.revisions;

  async function startExport() {
    if (!workspaceId || exporting) return;
    setExporting(true);
    setExportDialogOpen(true);
    setExportReceipt({
      status: 'signing_in_progress',
      workspaceName,
      sourceCount: draft.cites.length,
      version: draft.version,
      staleAtExport: draft.staleness ? { changelog: draft.staleness.changelog } : null,
      explainerStatus: 'pending',
    });
    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceId)}/skills/${encodeURIComponent(draft.id)}`,
        {
          method: 'POST',
          headers: csrfHeaders(),
        },
      );
      if (!response.ok) {
        setExportReceipt((current) => ({
          ...current,
          status: 'sign_failed',
          explainerStatus: 'failed',
          error: 'skill_export_failed',
        }));
        return;
      }
      const blob = await response.blob();
      downloadBlob(blob, `${draft.name}-skill.zip`);
      setExportReceipt({
        status: 'signed',
        workspaceName,
        sourceCount: draft.cites.length,
        version: draft.version,
        staleAtExport: draft.staleness ? { changelog: draft.staleness.changelog } : null,
        explainerStatus: 'ready',
        publicKeyUrl: `/api/workspaces/${encodeURIComponent(workspaceId)}/signing-key.pub`,
      });
    } catch {
      setExportReceipt((current) => ({
        ...current,
        status: 'sign_failed',
        explainerStatus: 'failed',
        error: 'network_error',
      }));
    } finally {
      setExporting(false);
    }
  }

  async function mintShareLink(): Promise<ShareLinkResult> {
    if (!workspaceId) throw new Error('no_active_workspace');
    const response = await fetch(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/skills/${encodeURIComponent(draft.id)}/share`,
      {
        method: 'POST',
        headers: csrfHeaders(),
      },
    );
    const payload = (await response.json().catch(() => ({}))) as ShareLinkResult & {
      error?: string;
    };
    if (!response.ok || !payload.url || !payload.expiresAt) {
      throw new Error(payload.error ?? 'share_failed');
    }
    return payload;
  }

  return (
    <>
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <div className="flex items-center gap-2.5">
          <span className="text-[14px] font-medium tracking-tight text-text-primary">
            {draft.name}
          </span>
          <span className="font-mono text-[10.5px] text-text-faint">v{draft.version}</span>
        </div>
        <div className="flex items-center gap-3">
          <Button
            size="sm"
            variant="primary"
            className="gap-1.5"
            disabled={exporting}
            onClick={() => void startExport()}
          >
            <Download size={12} strokeWidth={1.5} />
            {exporting ? 'Signing...' : 'Download'}
          </Button>
          <button
            type="button"
            onClick={onClose}
            className="font-mono text-[11px] text-text-faint hover:text-text-primary"
          >
            esc
          </button>
        </div>
      </div>

      {draft.staleness ? (
        <div className="border-b border-border px-5 py-2">
          <div className="flex items-center justify-between gap-3 border border-border px-3 py-2 text-[12px] text-text-body">
            <span>{draft.staleness.changelog}</span>
            <button
              type="button"
              onClick={() => void startExport()}
              disabled={exporting}
              className="shrink-0 font-medium text-accent disabled:cursor-progress disabled:text-text-faint"
            >
              {exporting ? 'Re-exporting...' : 'Re-export'}
            </button>
          </div>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <ChatColumn
          revisions={allRevisions}
          onRevise={onRevise}
          revising={revising}
          error={reviseError}
        />
        <SkillPreview draft={draft} />
      </div>

      <div className="flex items-center justify-between border-t border-border px-5 py-2 font-mono text-[10.5px] text-text-faint">
        <span>
          {draft.cites.length} sources · v{draft.version}
        </span>
        <span className="flex gap-3 text-accent">
          <a href="#frontmatter">frontmatter</a>
          <a href="#manifest">manifest</a>
          <a href="#history">history</a>
        </span>
      </div>

      <PostExportDialog
        open={exportDialogOpen}
        onOpenChange={setExportDialogOpen}
        draft={draft}
        receipt={exportReceipt}
        onMintShare={mintShareLink}
      />
    </>
  );
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function ChatColumn({
  revisions,
  onRevise,
  revising,
  error,
}: {
  revisions: SkillRevision[];
  onRevise: (text: string) => Promise<void>;
  revising: boolean;
  error: string | null;
}) {
  const [text, setText] = useState('');

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (revising || !text.trim()) return;
    void onRevise(text).then(() => setText(''));
  };

  return (
    <div className="flex w-[42%] flex-col border-r border-border">
      <div className="flex-1 space-y-3 overflow-auto px-4 py-3" aria-label="Skill draft revisions">
        {revisions.map((rev) => (
          <RevisionRow key={rev.id} revision={rev} />
        ))}
        {revising ? (
          <div className="font-mono text-[10px] text-text-faint">brain · revising…</div>
        ) : null}
        {error ? (
          <div role="alert" className="text-[11px] text-destructive">
            {humanizeReviseError(error)}
          </div>
        ) : null}
      </div>
      <form onSubmit={handleSubmit} className="border-t border-border px-3 py-3">
        <label className="sr-only" htmlFor="skill-revise-input">
          Ask the brain to revise
        </label>
        <input
          id="skill-revise-input"
          type="text"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={revising ? 'Revising…' : 'Ask for a change…'}
          disabled={revising}
          className="w-full rounded-md border border-border bg-white px-3 py-2 text-[12px] text-text-primary placeholder:text-text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:cursor-progress disabled:opacity-60"
        />
      </form>
    </div>
  );
}

function humanizeReviseError(code: string): string {
  switch (code) {
    case 'text_required':
      return 'Type something to revise.';
    case 'text_too_long':
      return 'That revision request is too long. Trim it under 2,000 characters.';
    case 'skill_version_unchanged':
      return 'The brain returned the same version. Try a clearer revision request.';
    case 'skill_generation_failed':
      return 'The brain couldn\u2019t apply that revision. Try rephrasing.';
    case 'skill_generation_timeout':
      return 'The brain took too long to draft. Try a simpler intent or try again in a moment.';
    case 'upstream_key_unconfigured':
      return 'No Anthropic key is configured. Add one under Settings \u2192 API Keys.';
    case 'chat_rate_limited':
    case 'chat_budget_exceeded':
      return 'You\u2019ve hit the daily budget. Try again later.';
    case 'network_error':
      return 'Couldn\u2019t reach the brain. Try again.';
    default:
      return 'Revision failed. Try again.';
  }
}

function RevisionRow({ revision }: { revision: SkillRevision }) {
  return (
    <div>
      <div
        className={cn(
          'mb-0.5 font-mono text-[9.5px] uppercase tracking-wider',
          revision.role === 'brain' ? 'text-accent' : 'text-text-faint',
        )}
      >
        {revision.role}
      </div>
      <div className="text-[12px] leading-relaxed text-text-body">
        {revision.text}
        {revision.cites ? (
          <span className="ml-1 font-mono text-[10px] text-accent">{revision.cites}</span>
        ) : null}
      </div>
    </div>
  );
}

function SkillPreview({ draft }: { draft: SkillDraft }) {
  return (
    <div className="flex-1 overflow-auto px-6 py-5">
      <h2 className="text-[16px] font-medium leading-title tracking-tight text-text-primary">
        {extractTitle(draft.body) ?? draft.name}
      </h2>
      <div className="mt-1 font-mono text-[10px] text-text-faint">
        {draft.name} · cites {draft.cites.map((c) => `[${c.index}]`).join(' ')}
      </div>
      <div className="mt-4 space-y-3 text-[12.5px] leading-[1.65] text-text-body">
        {renderMarkdown(draft.body)}
      </div>
    </div>
  );
}

function extractTitle(body: string): string | null {
  const match = body.match(/^# (.+)$/m);
  return match?.[1] ?? null;
}

function renderMarkdown(body: string): React.ReactNode[] {
  const blocks = body.split(/\n\n+/);
  return blocks.flatMap((block, index) => {
    if (block.startsWith('# ')) {
      // Title is rendered separately as the h2 above.
      return [];
    }
    if (block.startsWith('## ')) {
      return (
        <h3 key={index} className="mt-3 text-[12.5px] font-medium tracking-tight text-text-primary">
          {block.replace(/^## /, '')}
        </h3>
      );
    }
    return (
      <p key={index} className="text-text-body">
        {block}
      </p>
    );
  });
}

function LoadingState({ loading }: { loading: boolean }) {
  return (
    <div className="flex flex-1 items-center justify-center">
      <p aria-live="polite" className="font-mono text-xs text-text-subtle">
        {loading ? 'Loading…' : ''}
      </p>
    </div>
  );
}

function ErrorState({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-start gap-3 px-6 py-5">
      <p className="text-sm text-text-body">Couldn&rsquo;t load this draft.</p>
      <button onClick={onClose} className="font-mono text-xs text-accent hover:underline">
        Close
      </button>
    </div>
  );
}
