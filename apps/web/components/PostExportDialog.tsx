import * as Collapsible from '@radix-ui/react-collapsible';
import { Check, ChevronDown, ExternalLink, Link as LinkIcon } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';

import { Dialog, DialogClose, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { SkillDraft } from '@/lib/skill-types';
import {
  SKILL_TARGETS,
  skillInstallDestination,
  skillTargetById,
  skillTargetSteps,
  type SkillTargetId,
} from '@/lib/skill-targets';
import { cn } from '@/lib/utils';

const TARGET_STORAGE_KEY = 'open42.skillExport.installTarget';

export interface PostExportReceipt {
  status: 'signing_in_progress' | 'signed' | 'sign_failed';
  workspaceName?: string | null;
  sourceCount: number;
  version: string;
  publicKeyUrl?: string | null;
  explainer?: string | null;
  explainerStatus?: 'ready' | 'pending' | 'failed';
  staleAtExport?: { changelog: string } | null;
  error?: string | null;
}

export interface ShareLinkResult {
  url: string;
  expiresAt: string;
  publicKeyUrl?: string;
}

interface PostExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft: SkillDraft;
  receipt: PostExportReceipt;
  onMintShare: () => Promise<ShareLinkResult>;
}

type ShareState =
  | { status: 'share_unminted' }
  | { status: 'share_active'; url: string; expiresAt: string }
  | { status: 'share_expired'; url: string; expiresAt: string }
  | { status: 'share_error'; error: string };

export function PostExportDialog({
  open,
  onOpenChange,
  draft,
  receipt,
  onMintShare,
}: PostExportDialogProps) {
  const [targetId, setTargetId] = useState<SkillTargetId>(() => {
    const stored =
      typeof window !== 'undefined' ? window.localStorage.getItem(TARGET_STORAGE_KEY) : null;
    return skillTargetById(stored).id;
  });
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [share, setShare] = useState<ShareState>({ status: 'share_unminted' });
  const selectedTarget = skillTargetById(targetId);

  const installPath = useMemo(
    () => skillInstallDestination(selectedTarget, draft.name),
    [draft.name, selectedTarget],
  );
  const installSteps = useMemo(() => skillTargetSteps(selectedTarget), [selectedTarget]);

  function selectTarget(id: SkillTargetId) {
    setTargetId(id);
    window.localStorage.setItem(TARGET_STORAGE_KEY, id);
  }

  async function copy(value: string, key: string) {
    await navigator.clipboard.writeText(value);
    setCopiedKey(key);
    window.setTimeout(() => setCopiedKey((current) => (current === key ? null : current)), 2_000);
  }

  async function mintShare() {
    if (sharing || receipt.status !== 'signed') return;
    setSharing(true);
    try {
      const minted = await onMintShare();
      const expired = new Date(minted.expiresAt).getTime() <= Date.now();
      setShare({
        status: expired ? 'share_expired' : 'share_active',
        url: minted.url,
        expiresAt: minted.expiresAt,
      });
    } catch (err) {
      setShare({
        status: 'share_error',
        error: err instanceof Error ? err.message : 'share_failed',
      });
    } finally {
      setSharing(false);
    }
  }

  const receiptCopy = receiptText(receipt);
  const displayName = humanizeSkillName(draft.name);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]" aria-describedby={undefined}>
        <div className="max-h-[92vh] overflow-y-auto px-6 py-6">
          <div className="relative border-b border-border pb-5">
            <DialogClose className="absolute right-0 top-0 font-mono text-[11px] text-text-faint hover:text-text-primary">
              esc
            </DialogClose>
            <div className="flex items-end justify-between gap-4 pr-9">
              <DialogTitle className="text-[22px] font-medium leading-title tracking-tight text-text-primary">
                {displayName} Skill exported
              </DialogTitle>
              <span className="shrink-0 rounded border border-border bg-panel-soft px-2 py-1 font-mono text-[11px] text-text-subtle">
                v{receipt.version}
              </span>
            </div>
          </div>

          <div
            className={cn(
              'flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border py-4 font-mono text-[11px]',
              receipt.status === 'sign_failed' ? 'text-destructive' : 'text-text-subtle',
            )}
          >
            <span>{receiptCopy}</span>
            <span aria-hidden="true">·</span>
            <span>{receipt.sourceCount} cited sources</span>
            <span aria-hidden="true">·</span>
            <span className="inline-flex items-center gap-1.5">
              {receipt.staleAtExport ? null : (
                <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden="true" />
              )}
              {receipt.staleAtExport ? receipt.staleAtExport.changelog : 'all fresh'}
            </span>
            <span aria-hidden="true">·</span>
            <span>
              v{receipt.version}{' '}
              <button type="button" className="font-mono text-accent">
                changelog
              </button>
            </span>
          </div>

          {receipt.explainerStatus === 'pending' ? (
            <p className="mt-3 text-[12px] text-text-subtle">Explainer is still being written.</p>
          ) : null}
          {receipt.explainerStatus === 'ready' && receipt.explainer ? (
            <p className="mt-3 text-[13px] leading-relaxed text-text-body">{receipt.explainer}</p>
          ) : null}
          {receipt.explainerStatus === 'failed' ? (
            <p className="mt-3 text-[12px] text-text-subtle">
              Explainer failed, so the signed bundle shipped without one.
            </p>
          ) : null}

          <div className="mt-6">
            <h2 className="text-[18px] font-medium leading-title text-text-primary">Install in</h2>
            <div className="mt-4 flex border-b border-border">
              {SKILL_TARGETS.map((target) => (
                <button
                  key={target.id}
                  type="button"
                  onClick={() => selectTarget(target.id)}
                  className={cn(
                    'mr-8 border-b px-0 pb-3 text-[17px] font-medium text-text-subtle transition-colors',
                    target.id === targetId
                      ? 'border-accent text-text-primary'
                      : 'border-transparent hover:text-text-primary',
                  )}
                >
                  {target.label}
                </button>
              ))}
            </div>

            <div className="py-4">
              <div className="flex items-center justify-between gap-3 border border-border bg-panel-soft px-3 py-2">
                <code className="min-w-0 truncate font-mono text-[11px] text-text-primary">
                  {installPath}
                </code>
                <CopyButton
                  copied={copiedKey === 'install'}
                  onClick={() => void copy(installPath, 'install')}
                />
              </div>
              <ol className="mt-4 list-decimal space-y-2 pl-5 text-[14px] leading-relaxed text-text-body">
                {installSteps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </div>
          </div>

          <div className="-mx-6 flex flex-wrap items-center justify-between gap-3 border-y border-border px-6 py-4">
            <div>
              <Button
                type="button"
                variant="secondary"
                className="gap-1.5"
                disabled={sharing || receipt.status !== 'signed'}
                onClick={() => void mintShare()}
              >
                <LinkIcon size={14} strokeWidth={1.5} />
                {shareButtonLabel(share, sharing)}
              </Button>
              {share.status === 'share_unminted' ? (
                <p className="mt-2 text-[11px] text-text-subtle">
                  Share links expire in 24 hours; you can re-mint any time.
                </p>
              ) : null}
            </div>
            <Link
              href="/settings/mcp"
              className="inline-flex items-center gap-1.5 text-[13px] font-medium text-accent"
            >
              Connect an MCP-compatible agent instead
              <ExternalLink size={13} strokeWidth={1.5} />
            </Link>
          </div>

          {share.status === 'share_active' || share.status === 'share_expired' ? (
            <div className="mt-3 flex items-center justify-between gap-3 border border-border px-3 py-2">
              <code className="min-w-0 truncate font-mono text-[11px] text-text-primary">
                {share.url}
              </code>
              <CopyButton
                copied={copiedKey === 'share'}
                onClick={() => void copy(share.url, 'share')}
              />
            </div>
          ) : null}
          {share.status === 'share_error' ? (
            <p role="alert" className="mt-3 text-[12px] text-destructive">
              Share link failed. Try again.
            </p>
          ) : null}

          <Collapsible.Root className="-mx-6 px-6 pt-5">
            <Collapsible.Trigger className="flex w-full items-center justify-between text-left text-[18px] font-medium text-text-primary">
              <span>Generated from</span>
              <ChevronDown size={14} strokeWidth={1.5} />
            </Collapsible.Trigger>
            <Collapsible.Content className="pt-3">
              <ul className="space-y-1.5 text-[13px] text-text-body">
                {draft.cites.map((cite) => (
                  <li key={`${cite.index}-${cite.slug}`}>
                    <span className="font-mono text-[10.5px] text-text-subtle">
                      [{cite.index}]
                    </span>{' '}
                    {cite.slug}{' '}
                    <span className="font-mono text-[10px] text-text-faint">
                      Generated at export
                    </span>
                  </li>
                ))}
              </ul>
            </Collapsible.Content>
          </Collapsible.Root>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CopyButton({ copied, onClick }: { copied: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-md border border-border bg-white px-3 text-[13px] font-medium text-text-primary shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-colors hover:border-border-strong"
    >
      {copied ? <Check size={16} strokeWidth={1.5} /> : null}
      {copied ? 'Copied!' : 'Copy'}
    </button>
  );
}

function receiptText(receipt: PostExportReceipt): string {
  if (receipt.status === 'signing_in_progress') return 'Signing in progress';
  if (receipt.status === 'sign_failed') return 'Signing failed';
  return `Signed by ${receipt.workspaceName || 'workspace'}`;
}

function shareButtonLabel(share: ShareState, sharing: boolean): string {
  if (sharing) return 'Generating...';
  if (share.status === 'share_active') return 'Share link active';
  if (share.status === 'share_expired') return 'Share link expired';
  return 'Generate share link';
}

function humanizeSkillName(name: string): string {
  return name
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}
