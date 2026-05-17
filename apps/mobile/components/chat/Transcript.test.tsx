import { Pressable } from 'react-native';
import { expect, it, vi } from 'vitest';

import { act, render, textContent } from '@/test/render';

import { CitationChip } from './CitationChip';
import { Transcript } from './Transcript';

const citation = {
  index: 1,
  slug: 'https://docs.open42.test/refunds',
  version_id: 4,
  last_updated: '2026-05-01T00:00:00.000Z',
  excerpt: 'Refunds are handled by finance.',
};

it('renders citation chips in assistant text and routes taps to the citation callback', () => {
  const onCitation = vi.fn();
  const tree = render(
    <Transcript
      messages={[
        {
          id: 'a-1',
          role: 'assistant',
          text: 'Refunds are handled by finance [1].',
          citations: [citation],
        },
      ]}
      thinking={false}
      activeCitation={null}
      onCitation={onCitation}
      onRetry={vi.fn()}
    />
  );

  expect(textContent(tree.root)).toContain('Refunds are handled by finance');

  const chip = tree.root.findAllByType(CitationChip)[0]!;
  act(() => chip.props.onPress(citation));

  expect(onCitation).toHaveBeenCalledWith(citation);
});

it('renders retry chips for failed assistant turns', () => {
  const onRetry = vi.fn();
  const tree = render(
    <Transcript
      messages={[
        {
          id: 'a-1',
          role: 'assistant',
          text: '',
          error: 'network_error',
          retryQuery: 'Try again',
        },
      ]}
      thinking
      activeCitation={null}
      onCitation={vi.fn()}
      onRetry={onRetry}
    />
  );

  expect(textContent(tree.root)).toContain('Could not reach Open42.');
  expect(textContent(tree.root)).toContain('brain · reading sources');

  const retry = tree.root
    .findAllByType(Pressable as any)
    .find((node) => node.findAll((child) => child.props.children === 'Retry').length > 0)!;
  act(() => retry.props.onPress());

  expect(onRetry).toHaveBeenCalledWith('a-1');
});
