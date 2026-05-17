import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PostExportDialog, type PostExportReceipt } from '@/components/PostExportDialog';
import { SKILL_TARGETS } from '@/lib/skill-targets';
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

    expect(screen.getAllByText(target.installPath, { exact: false }).length).toBeGreaterThan(0);
    for (const step of target.steps) {
      expect(screen.getByText(step)).toBeInTheDocument();
    }
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
