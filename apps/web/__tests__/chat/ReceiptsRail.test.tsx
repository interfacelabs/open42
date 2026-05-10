import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { ReceiptsRail } from '@/components/ReceiptsRail';
import type { Citation } from '@/components/chat-types';

const sample: Citation[] = [
  {
    index: 1,
    slug: 'refund-policy-v3',
    version_id: 3,
    last_updated: '2026-05-08',
    excerpt: 'Annual plans are refundable pro-rated within 30 days.',
  },
  {
    index: 2,
    slug: 'billing-faq',
    version_id: null,
    last_updated: '2026-04-25',
    excerpt: 'After the window, refund requests convert to credit.',
  },
];

describe('ReceiptsRail', () => {
  it('renders nothing when there are no citations', () => {
    const { container } = render(
      <ReceiptsRail citations={[]} activeIndex={null} onActivate={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows one card per citation with index, slug, and excerpt', () => {
    render(
      <ReceiptsRail
        citations={sample}
        activeIndex={null}
        onActivate={vi.fn()}
      />,
    );
    expect(screen.getByText(/sources · 2/i)).toBeInTheDocument();
    expect(screen.getByText('refund-policy-v3')).toBeInTheDocument();
    expect(screen.getByText('billing-faq')).toBeInTheDocument();
    expect(
      screen.getByText(/Annual plans are refundable pro-rated/),
    ).toBeInTheDocument();
  });

  it('activates a card on hover and click', () => {
    const onActivate = vi.fn();
    render(
      <ReceiptsRail
        citations={sample}
        activeIndex={null}
        onActivate={onActivate}
      />,
    );
    const [first, second] = screen.getAllByRole('button');
    if (!first || !second) throw new Error('expected two cards');
    fireEvent.mouseEnter(first);
    expect(onActivate).toHaveBeenCalledWith(1);
    fireEvent.click(second);
    expect(onActivate).toHaveBeenCalledWith(2);
  });

  it('reflects aria-pressed on the active card', () => {
    render(
      <ReceiptsRail citations={sample} activeIndex={2} onActivate={vi.fn()} />,
    );
    const [first, second] = screen.getAllByRole('button');
    if (!first || !second) throw new Error('expected two cards');
    expect(first).toHaveAttribute('aria-pressed', 'false');
    expect(second).toHaveAttribute('aria-pressed', 'true');
  });
});
