import { expect, it, vi } from 'vitest';

import { act, findPressableByText, render } from '@/test/render';

import { Button } from './Button';

it('fires press actions', () => {
  const onPress = vi.fn();
  const tree = render(<Button onPress={onPress}>Send code</Button>);

  act(() => findPressableByText(tree.root, 'Send code').props.onPress());

  expect(onPress).toHaveBeenCalledTimes(1);
});
