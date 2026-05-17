import { expect, it, vi } from 'vitest';

vi.mock('react-native', async () => await import('@/test/react-native'));

it('is queryable through React Native Testing Library', async () => {
  const { render } = await import('@testing-library/react-native');
  const { AppText } = await import('./Text');

  const result = render(<AppText variant="section">Receipts first</AppText>);

  expect(result.getByText('Receipts first')).toBeTruthy();
});
