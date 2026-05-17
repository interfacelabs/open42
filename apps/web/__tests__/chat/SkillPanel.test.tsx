import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('swr', async () => {
  const actual = await vi.importActual<typeof import('swr')>('swr');
  return {
    ...actual,
    default: vi.fn(),
  };
});

vi.mock('@/components/PostExportDialog', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return {
    PostExportDialog: ({
      open,
      receipt,
    }: {
      open: boolean;
      receipt: {
        status?: string;
        staleAtExport?: { changelog: string } | null;
        explainer?: string | null;
      };
    }) =>
      open
        ? React.createElement(
            'div',
            { role: 'dialog' },
            React.createElement('span', { 'data-testid': 'export-status' }, receipt.status),
            React.createElement('span', null, receipt.staleAtExport?.changelog ?? 'all fresh'),
            receipt.explainer
              ? React.createElement('span', null, receipt.explainer)
              : null,
          )
        : null,
  };
});

import useSWR from 'swr';
import { exportStalenessForReceipt, SkillPanel } from '@/components/SkillPanel';
import type { SkillDraft } from '@/lib/skill-types';
import { __resetWorkspaceStoreForTests, useWorkspaceStore } from '@/lib/workspaces/store';

const mockSWR = useSWR as unknown as ReturnType<typeof vi.fn>;

const FIXTURE_DRAFT: SkillDraft = {
  id: 'refund-policy',
  name: 'refund-policy',
  version: '0.1.2',
  cites: [
    { index: 1, slug: 'refund-policy-v3', lastUpdated: '2h ago' },
    { index: 2, slug: 'billing-faq', lastUpdated: '14d ago' },
    { index: 3, slug: 'enterprise-msa', lastUpdated: '90d ago' },
  ],
  revisions: [
    { id: 'r1', role: 'you', text: 'Draft a skill from this thread.' },
    {
      id: 'r2',
      role: 'brain',
      text: 'Drafted v0.1.0 from 3 sources.',
      cites: '[1] [2] [3]',
    },
    { id: 'r3', role: 'you', text: 'Add a section on partial refunds.' },
    {
      id: 'r4',
      role: 'brain',
      text: 'Added. Pulled from policy v3 §2.3.',
      cites: '[1]',
    },
  ],
  body: '# Refund Policy\n\n## Annual plans\n\nPro-rated refund within 30 days.\n\n## Partial refunds\n\nPro-rata calculation.\n\n## Enterprise\n\nMSA may override.',
};

describe('SkillPanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    __resetWorkspaceStoreForTests();
    useWorkspaceStore.setState({
      currentWorkspaceId: 'ws-1',
      workspaces: [{ id: 'ws-1', name: 'Acme Corp', role: 'owner', status: 'ready' }],
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Blob(['zip']), { status: 200 })),
    );
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:skill'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    mockSWR.mockReset();
    mockSWR.mockReturnValue({
      data: { draft: FIXTURE_DRAFT },
      error: null,
      isLoading: false,
      mutate: vi.fn(),
    });
  });

  it('renders nothing when draftId is null', () => {
    const { container } = render(<SkillPanel draftId={null} onClose={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders header with name + version when open', () => {
    render(<SkillPanel draftId="refund-policy" onClose={() => {}} />);
    expect(screen.getByText('refund-policy')).toBeInTheDocument();
    expect(screen.getByText('v0.1.2')).toBeInTheDocument();
  });

  it('shows the revision log + composer + footer', () => {
    render(<SkillPanel draftId="refund-policy" onClose={() => {}} />);
    expect(screen.getByText('Draft a skill from this thread.')).toBeInTheDocument();
    expect(screen.getByText('Added. Pulled from policy v3 §2.3.')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/ask for a change/i)).toBeInTheDocument();
    expect(screen.getByText(/3 sources · v0\.1\.2/i)).toBeInTheDocument();
  });

  it('renders the markdown body as the preview', () => {
    render(<SkillPanel draftId="refund-policy" onClose={() => {}} />);
    expect(screen.getByRole('heading', { name: /refund policy/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /partial refunds/i })).toBeInTheDocument();
  });

  it('shows stale changelog copy with a Re-export CTA', () => {
    const staleDraft = {
      ...FIXTURE_DRAFT,
      staleness: {
        changelog: 'Refund policy changed since this skill was exported.',
        detectedAt: '2026-05-17T00:00:00.000Z',
      },
    };
    const mutate = vi.fn(async () => ({
      ...staleDraft,
      explainer: 'Use this skill when answering refund-policy questions.',
    }));
    mockSWR.mockReturnValue({
      data: { draft: staleDraft },
      error: null,
      isLoading: false,
      mutate,
    });

    render(<SkillPanel draftId="refund-policy" onClose={() => {}} />);

    expect(
      screen.getByText('Refund policy changed since this skill was exported.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /re-export/i })).toBeInTheDocument();
  });

  it('uses the refreshed draft to decide whether the export receipt is stale', () => {
    const staleDraft: SkillDraft = {
      ...FIXTURE_DRAFT,
      staleness: {
        changelog: 'Refund policy changed since this skill was exported.',
        detectedAt: '2026-05-17T00:00:00.000Z',
      },
    };
    const freshAfterExport: SkillDraft = {
      ...staleDraft,
      staleness: null,
      explainer: 'Use this skill when answering refund-policy questions.',
    };

    expect(exportStalenessForReceipt(staleDraft)).toEqual({
      changelog: 'Refund policy changed since this skill was exported.',
    });
    expect(exportStalenessForReceipt(staleDraft, freshAfterExport)).toBeNull();
  });

  it('re-exports a stale skill and opens the post-export dialog with the refreshed receipt', async () => {
    const staleDraft: SkillDraft = {
      ...FIXTURE_DRAFT,
      staleness: {
        changelog: 'Refund policy changed since this skill was exported.',
        detectedAt: '2026-05-17T00:00:00.000Z',
      },
    };
    const freshAfterExport: SkillDraft = {
      ...staleDraft,
      staleness: null,
      explainer: 'Use this skill when answering refund-policy questions.',
    };
    const mutate = vi.fn(async () => freshAfterExport);
    const fetchImpl = vi.fn(async () => new Response('zip', { status: 200 }));
    mockSWR.mockReturnValue({
      data: { draft: staleDraft },
      error: null,
      isLoading: false,
      mutate,
    });

    render(
      <SkillPanel
        draftId="refund-policy"
        onClose={() => {}}
        fetchImpl={fetchImpl as unknown as typeof fetch}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /^re-export$/i }));

    await waitFor(() => {
      expect(fetchImpl).toHaveBeenCalledWith('/api/workspaces/ws-1/skills/refund-policy', {
        method: 'POST',
        headers: expect.any(Object),
      });
    });

    await waitFor(() => expect(screen.getByTestId('export-status')).toHaveTextContent('signed'));
    expect(screen.getByText('all fresh')).toBeInTheDocument();
    expect(screen.getByText('Use this skill when answering refund-policy questions.')).toBeInTheDocument();
    expect(mutate).toHaveBeenCalled();
  });
});
