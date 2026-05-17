import { expect, it, vi } from 'vitest';

import { act, findByText, render } from '@/test/render';

import { Sheet } from './Sheet';
import { AppText } from './Text';

it('renders visible content and closes', () => {
  const onClose = vi.fn();
  const tree = render(
    <Sheet visible title="Citation" onClose={onClose}>
      <AppText>Source excerpt</AppText>
    </Sheet>
  );

  expect(findByText(tree.root, 'Source excerpt')).toBeTruthy();
  const close = tree.root.findAll((node) => node.props.accessibilityLabel === 'Close')[0]!;
  act(() => close.props.onPress());

  expect(onClose).toHaveBeenCalledTimes(1);
});
