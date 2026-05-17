import { expect, it } from 'vitest';

import { findByText, render } from '@/test/render';

import { AppText } from './Text';

it('renders Geist text presets', () => {
  const tree = render(<AppText variant="title">Receipts first</AppText>);

  expect(findByText(tree.root, 'Receipts first')).toBeTruthy();
});
