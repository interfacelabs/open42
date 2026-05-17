import * as Collapsible from '@radix-ui/react-collapsible';
import { Check, ChevronDown, Copy, ExternalLink, Link as LinkIcon } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';

import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { SkillDraft } from '@/lib/skill-types';
import { SKILL_TARGETS, skillTargetById, type SkillTargetId } from '@/lib/skill-targets';
import { cn } from '@/lib/utils';

const TARGET_STORAGE_KEY = 'open42.skillExport.installTarget';

export interface PostExportReceipt {
  status: 'signing_in_progress' | 'signed' | 'sign_failed';
  workspaceName?: string | null;
  sourceCount: number;
  version: string;
  publicKeyUrl?: string | null;
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

  const installCommand = useMemo(
    () => `unzip ${draft.name}-skill.zip -d ${selectedTarget.installPath}`,
    [draft.name, selectedTarget.installPath],
  );

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <div className="max-h-[92vh] overflow-y-auto px-5 py-5 sm:px-6">
          <div>
            <DialogTitle className="text-[20px] font-medium leading-title tracking-tight text-text-primary">
              Install {draft.name}
            </DialogTitle>
            <DialogDescription className="mt-1 text-[13px] leading-relaxed text-text-subtle">
              The signed bundle is ready for your local agent.
            </DialogDescription>
          </div>

          <div
            className={cn(
              'mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 border border-border px-3 py-2 font-mono text-[10.5px]',
              receipt.status === 'sign_failed' ? 'text-destructive' : 'text-text-subtle',
            )}
          >
            <span>{receiptCopy}</span>
            <span>{receipt.sourceCount} sources</span>
            <span>{receipt.staleAtExport ? receipt.staleAtExport.changelog : 'all fresh'}</span>
            <span>v{receipt.version} changelog</span>
          </div>

          {receipt.explainerStatus === 'pending' ? (
            <p className="mt-3 text-[12px] text-text-subtle">Explainer is still being written.</p>
          ) : null}
          {receipt.explainerStatus === 'failed' ? (
            <p className="mt-3 text-[12px] text-text-subtle">
              Explainer failed, so the signed bundle shipped without one.
            </p>
          ) : null}

          <div className="mt-6">
            <div className="flex border-b border-border">
              {SKILL_TARGETS.map((target) => (
                <button
                  key={target.id}
                  type="button"
                  onClick={() => selectTarget(target.id)}
                  className={cn(
                    'mr-5 border-b px-0 pb-2 text-[13px] font-medium text-text-subtle transition-colors',
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
                  {installCommand}
                </code>
                <CopyButton
                  copied={copiedKey === 'install'}
                  onClick={() => void copy(installCommand, 'install')}
                />
              </div>
              <ol className="mt-3 space-y-2 text-[13px] leading-relaxed text-text-body">
                {selectedTarget.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="gap-1.5"
              disabled={sharing || receipt.status !== 'signed'}
              onClick={() => void mintShare()}
            >
              <LinkIcon size={14} strokeWidth={1.5} />
              {shareButtonLabel(share, sharing)}
            </Button>
            <Link
              href="/settings/mcp"
              className="inline-flex items-center gap-1.5 text-[13px] font-medium text-accent"
            >
              MCP endpoint
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

          <Collapsible.Root className="mt-5 border-t border-border pt-4">
            <Collapsible.Trigger className="flex w-full items-center justify-between text-left text-[12px] font-medium text-text-subtle">
              <span>Generated from</span>
              <ChevronDown size={14} strokeWidth={1.5} />
            </Collapsible.Trigger>
            <Collapsible.Content className="pt-3">
              <ul className="space-y-1.5 font-mono text-[10.5px] text-text-subtle">
                {draft.cites.map((cite) => (
                  <li key={`${cite.index}-${cite.slug}`}>
                    [{cite.index}] {cite.slug}
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
      className="inline-flex shrink-0 items-center gap-1.5 text-[12px] font-medium text-text-subtle hover:text-text-primary"
    >
      {copied ? <Check size={14} strokeWidth={1.5} /> : <Copy size={14} strokeWidth={1.5} />}
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
  if (sharing) return 'Minting...';
  if (share.status === 'share_active') return 'Share active';
  if (share.status === 'share_expired') return 'Share expired';
  return 'Share';
}
