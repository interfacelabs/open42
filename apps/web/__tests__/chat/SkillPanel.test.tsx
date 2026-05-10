import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('swr', async () => {
  const actual = await vi.importActual<typeof import('swr')>('swr');
  return {
    ...actual,
    default: vi.fn(),
  };
});

import useSWR from 'swr';
import { SkillPanel } from '@/components/SkillPanel';
import type { SkillDraft } from '@/lib/skill-types';

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
  body:
    '# Refund Policy\n\n## Annual plans\n\nPro-rated refund within 30 days.\n\n## Partial refunds\n\nPro-rata calculation.\n\n## Enterprise\n\nMSA may override.',
};

describe('SkillPanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockSWR.mockReset();
    mockSWR.mockReturnValue({
      data: { draft: FIXTURE_DRAFT },
      error: null,
      isLoading: false,
      mutate: vi.fn(),
    });
  });

  it('renders nothing when draftId is null', () => {
    const { container } = render(
      <SkillPanel draftId={null} onClose={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders header with name + version when open', () => {
    render(<SkillPanel draftId="refund-policy" onClose={() => {}} />);
    expect(screen.getByText('refund-policy')).toBeInTheDocument();
    expect(screen.getByText('v0.1.2')).toBeInTheDocument();
  });

  it('shows the revision log + composer + footer', () => {
    render(<SkillPanel draftId="refund-policy" onClose={() => {}} />);
    expect(
      screen.getByText('Draft a skill from this thread.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Added. Pulled from policy v3 §2.3.'),
    ).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/ask for a change/i)).toBeInTheDocument();
    expect(screen.getByText(/3 sources · v0\.1\.2/i)).toBeInTheDocument();
  });

  it('renders the markdown body as the preview', () => {
    render(<SkillPanel draftId="refund-policy" onClose={() => {}} />);
    expect(
      screen.getByRole('heading', { name: /refund policy/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /partial refunds/i }),
    ).toBeInTheDocument();
  });
});
