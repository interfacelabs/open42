import { Linking } from 'react-native';
import { expect, it, vi } from 'vitest';

import { act, findPressableByText, render, textContent } from '@/test/render';

import { CitationDetailSheet } from './CitationDetailSheet';

it('shows citation receipt details and opens HTTP source links', async () => {
  const openURL = vi.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  const tree = render(
    <CitationDetailSheet
      citation={{
        index: 1,
        slug: 'https://docs.open42.test/refunds',
        version_id: 4,
        last_updated: '2026-05-01T00:00:00.000Z',
        excerpt: 'Refunds are handled by finance.',
      }}
      onClose={vi.fn()}
    />
  );

  const copy = textContent(tree.root);
  expect(copy).toContain('Source [1]');
  expect(copy).toContain('https://docs.open42.test/refunds');
  expect(copy).toContain('version 4');
  expect(copy).toContain('Refunds are handled by finance.');

  await act(async () => {
    await findPressableByText(tree.root, 'Open source').props.onPress();
  });

  expect(openURL).toHaveBeenCalledWith('https://docs.open42.test/refunds');
});

it('renders a fallback excerpt for sourced rows without excerpts', () => {
  const tree = render(
    <CitationDetailSheet
      citation={{
        index: 2,
        slug: 'internal-policy',
        version_id: null,
        last_updated: null,
        excerpt: '',
      }}
      onClose={vi.fn()}
    />
  );

  const copy = textContent(tree.root);
  expect(copy).toContain('Source [2]');
  expect(copy).toContain('internal-policy');
  expect(copy).toContain('version unknown');
  expect(copy).toContain('No excerpt was returned for this source.');
});
