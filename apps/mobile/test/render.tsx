import type { ReactTestInstance } from 'react-test-renderer';
import { act, create } from 'react-test-renderer';
import { Pressable, Text, TextInput } from 'react-native';

export { act };

export function render(element: React.ReactElement) {
  let tree: ReturnType<typeof create> | null = null;
  act(() => {
    tree = create(element as any);
  });
  return tree!;
}

export function findByText(root: ReactTestInstance, text: string): ReactTestInstance {
  return root.findAll((node) => textFrom(node) === text)[0]!;
}

export function findPressableByText(root: ReactTestInstance, text: string): ReactTestInstance {
  return root
    .findAllByType(Pressable as any)
    .find((node) => node.findAll((child) => textFrom(child) === text).length > 0)!;
}

export function findTextInputByPlaceholder(root: ReactTestInstance, placeholder: string) {
  return root
    .findAllByType(TextInput as any)
    .find((node) => node.props.placeholder === placeholder)!;
}

export function textContent(root: ReactTestInstance): string {
  return root
    .findAllByType(Text as any)
    .map(textFrom)
    .join(' ');
}

function textFrom(node: ReactTestInstance): string {
  const children = node.props.children;
  if (typeof children === 'string') return children;
  if (Array.isArray(children)) {
    return children.map((child) => (typeof child === 'string' ? child : '')).join('');
  }
  return '';
}
