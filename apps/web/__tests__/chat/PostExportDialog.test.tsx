import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PostExportDialog, type PostExportReceipt } from '@/components/PostExportDialog';
import { SKILL_TARGETS, skillInstallDestination, skillTargetSteps } from '@/lib/skill-targets';
import type { SkillDraft } from '@/lib/skill-types';

const draft: SkillDraft = {
  id: 'skill-1',
  name: 'refund-policy',
  version: '0.1.2',
  body: '## Contract\n\nUse cited sources.',
  cites: [
    { index: 1, slug: 'refund-policy' },
    { index: 2, slug: 'billing-faq' },
  ],
  revisions: [],
};

const signedReceipt: PostExportReceipt = {
  status: 'signed',
  workspaceName: 'Acme Corp',
  sourceCount: 2,
  version: '0.1.2',
  publicKeyUrl: '/api/workspaces/ws/signing-key.pub',
  explainer: 'Use this skill when answering refund-policy questions from cited company sources.',
  explainerStatus: 'ready',
};

describe('PostExportDialog', () => {
  beforeEach(() => {
    window.localStorage.clear();
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn(async () => undefined) },
    });
  });

  it.each(SKILL_TARGETS)('renders install steps for %s', (target) => {
    renderDialog({ receipt: signedReceipt });

    fireEvent.click(screen.getByRole('button', { name: target.label }));

    expect(screen.getByText(skillInstallDestination(target, draft.name))).toBeInTheDocument();
    for (const step of skillTargetSteps(target)) {
      expect(screen.getByText(step)).toBeInTheDocument();
    }
  });

  it('defaults to openclaw and restores the persisted install target', () => {
    const openclaw = SKILL_TARGETS.find((target) => target.id === 'openclaw')!;
    const claudeCode = SKILL_TARGETS.find((target) => target.id === 'claude-code')!;
    const first = renderDialog({ receipt: signedReceipt });

    expect(screen.getByText(skillInstallDestination(openclaw, draft.name))).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: claudeCode.label }));
    expect(window.localStorage.getItem('open42.skillExport.installTarget')).toBe('claude-code');
    expect(screen.getByText(skillInstallDestination(claudeCode, draft.name))).toBeInTheDocument();

    first.unmount();
    renderDialog({ receipt: signedReceipt });

    expect(screen.getByText(skillInstallDestination(claudeCode, draft.name))).toBeInTheDocument();
  });

  it('falls back to openclaw when the persisted install target is unknown', () => {
    const openclaw = SKILL_TARGETS.find((target) => target.id === 'openclaw')!;
    window.localStorage.setItem('open42.skillExport.installTarget', 'cursor');

    renderDialog({ receipt: signedReceipt });

    expect(screen.getByText(skillInstallDestination(openclaw, draft.name))).toBeInTheDocument();
  });

  it('matches the receipt-first export hierarchy without an in-dialog download action', () => {
    renderDialog({ receipt: signedReceipt });

    expect(screen.getByText('Refund Policy Skill exported')).toBeInTheDocument();
    expect(screen.getByText('Signed by Acme Corp')).toBeInTheDocument();
    expect(
      screen.getByText(/Use this skill when answering refund-policy questions/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Install in' })).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /connect an mcp-compatible agent instead/i }),
    ).toHaveAttribute('href', '/settings/mcp');
    expect(screen.getByText(/Share links expire in 24 hours/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /download/i })).not.toBeInTheDocument();
  });

  it('shows signing progress, explainer failure, and stale-at-export copy', () => {
    renderDialog({
      receipt: {
        ...signedReceipt,
        status: 'signing_in_progress',
        explainerStatus: 'failed',
        staleAtExport: { changelog: 'Refund policy changed.' },
      },
    });

    expect(screen.getByText(/Signing in progress/i)).toBeInTheDocument();
    expect(screen.getByText(/Explainer failed/i)).toBeInTheDocument();
    expect(screen.getByText('Refund policy changed.')).toBeInTheDocument();
  });

  it('renders explainer pending and signing failure states', () => {
    const { rerender } = render(
      <PostExportDialog
        open
        onOpenChange={() => undefined}
        draft={draft}
        receipt={{ ...signedReceipt, explainerStatus: 'pending' }}
        onMintShare={async () => ({
          url: 'https://api.open42.ai/shared/token.zip',
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        })}
      />,
    );

    expect(screen.getByText(/Explainer is still being written/i)).toBeInTheDocument();

    rerender(
      <PostExportDialog
        open
        onOpenChange={() => undefined}
        draft={draft}
        receipt={{ ...signedReceipt, status: 'sign_failed' }}
        onMintShare={async () => ({
          url: 'https://api.open42.ai/shared/token.zip',
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        })}
      />,
    );

    expect(screen.getByText(/Signing failed/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /generate share link/i })).toBeDisabled();
  });

  it('mints a share link and exposes copy feedback without a toast', async () => {
    renderDialog({
      receipt: signedReceipt,
      onMintShare: async () => ({
        url: 'https://api.open42.ai/shared/token.zip',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    });

    fireEvent.click(screen.getByRole('button', { name: /share/i }));
    expect(await screen.findByText('https://api.open42.ai/shared/token.zip')).toBeInTheDocument();

    const copyButtons = screen.getAllByRole('button', { name: /^copy$/i });
    fireEvent.click(copyButtons.at(-1)!);
    await waitFor(() => expect(screen.getByText('Copied!')).toBeInTheDocument());
  });

  it('renders expired share links when the minter returns an expired URL', async () => {
    renderDialog({
      receipt: signedReceipt,
      onMintShare: async () => ({
        url: 'https://api.open42.ai/shared/expired.zip',
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      }),
    });

    fireEvent.click(screen.getByRole('button', { name: /generate share link/i }));

    expect(await screen.findByRole('button', { name: /share link expired/i })).toBeInTheDocument();
    expect(screen.getByText('https://api.open42.ai/shared/expired.zip')).toBeInTheDocument();
  });
});

function renderDialog(options: {
  receipt: PostExportReceipt;
  onMintShare?: () => Promise<{ url: string; expiresAt: string }>;
}) {
  return render(
    <PostExportDialog
      open
      onOpenChange={() => undefined}
      draft={draft}
      receipt={options.receipt}
      onMintShare={
        options.onMintShare ??
        (async () => ({
          url: 'https://api.open42.ai/shared/token.zip',
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        }))
      }
    />,
  );
}
