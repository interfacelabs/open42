import { beforeEach, expect, it, vi } from 'vitest';

import { act, findPressableByText, findTextInputByPlaceholder, render } from '@/test/render';
import { apiFetch } from '@/utils/api';

import { OnboardingInvitesScreen } from './OnboardingInvitesScreen';

vi.mock('@/utils/api', async () => {
  const actual = await vi.importActual<typeof import('@/utils/api')>('@/utils/api');
  return {
    ...actual,
    apiFetch: vi.fn(async () => ({ sent: 2, failed: 0 })),
  };
});

const navigation = { navigate: vi.fn() } as any;
const route = {
  key: 'OnboardingInvites',
  name: 'OnboardingInvites',
  params: { workspaceName: 'Acme Operations' },
} as const;

beforeEach(() => {
  vi.clearAllMocks();
});

it('normalizes teammate emails and advances to onboarding done', async () => {
  const tree = render(<OnboardingInvitesScreen navigation={navigation} route={route} />);

  await act(async () => {
    findTextInputByPlaceholder(tree.root, 'ana@company.com, tom@company.com').props.onChangeText(
      'ANA@Company.com, tom@company.com\nana@company.com'
    );
  });

  await act(async () => {
    await findPressableByText(tree.root, 'Send invites').props.onPress();
  });

  expect(apiFetch).toHaveBeenCalledWith('/workspaces/onboarding/invites', {
    method: 'POST',
    body: { emails: ['ana@company.com', 'tom@company.com'] },
  });
  expect(navigation.navigate).toHaveBeenCalledWith('OnboardingDone', {
    workspaceName: 'Acme Operations',
  });
});

it('can skip teammate invites', async () => {
  const tree = render(<OnboardingInvitesScreen navigation={navigation} route={route} />);

  await act(async () => {
    await findPressableByText(tree.root, 'Skip for now').props.onPress();
  });

  expect(apiFetch).toHaveBeenCalledWith('/workspaces/onboarding/invites', {
    method: 'POST',
    body: { emails: [] },
  });
  expect(navigation.navigate).toHaveBeenCalledWith('OnboardingDone', {
    workspaceName: 'Acme Operations',
  });
});
