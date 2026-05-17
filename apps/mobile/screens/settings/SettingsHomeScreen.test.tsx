import { expect, it, vi } from 'vitest';

import { act, findPressableByText, render, textContent } from '@/test/render';

import { SettingsHomeScreen } from './SettingsHomeScreen';

it('routes to every settings surface in the P1 menu', () => {
  const navigation = { navigate: vi.fn() } as any;
  const tree = render(
    <SettingsHomeScreen
      navigation={navigation}
      route={{ key: 'SettingsHome', name: 'SettingsHome' }}
    />
  );

  expect(textContent(tree.root)).toContain('Workspace controls');

  act(() => findPressableByText(tree.root, 'Account').props.onPress());
  act(() => findPressableByText(tree.root, 'Members').props.onPress());
  act(() => findPressableByText(tree.root, 'API keys').props.onPress());
  act(() => findPressableByText(tree.root, 'MCP').props.onPress());
  act(() => findPressableByText(tree.root, 'Plan').props.onPress());
  act(() => findPressableByText(tree.root, 'Connections').props.onPress());
  act(() => findPressableByText(tree.root, 'Sign out').props.onPress());

  expect(navigation.navigate).toHaveBeenCalledWith('Account');
  expect(navigation.navigate).toHaveBeenCalledWith('Members');
  expect(navigation.navigate).toHaveBeenCalledWith('ApiKeys');
  expect(navigation.navigate).toHaveBeenCalledWith('Mcp');
  expect(navigation.navigate).toHaveBeenCalledWith('Plan');
  expect(navigation.navigate).toHaveBeenCalledWith('Connections');
  expect(navigation.navigate).toHaveBeenCalledWith('SignOut');
});
