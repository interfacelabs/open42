import { expect, it, vi } from 'vitest';

import { act, render } from '@/test/render';
import { AppText } from '@/components/ui/Text';

import { CitationChip } from './CitationChip';

it('opens citation details on press', () => {
  const onPress = vi.fn();
  const citation = {
    index: 1,
    slug: 'refund-policy',
    version_id: 4,
    last_updated: '2026-05-01T00:00:00.000Z',
    excerpt: 'Refunds are handled by finance.',
  };
  const tree = render(<CitationChip citation={citation} onPress={onPress} />);

  const chip = tree.root.findAll((node) => node.type === AppText)[0]!;
  act(() => chip.props.onPress());

  expect(onPress).toHaveBeenCalledWith(citation);
});
