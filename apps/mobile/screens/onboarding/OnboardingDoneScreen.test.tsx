import { beforeEach, expect, it, vi } from 'vitest';

import { useAuthStore } from '@/store/auth';
import { render, textContent } from '@/test/render';

import { OnboardingDoneScreen } from './OnboardingDoneScreen';

const authState = {
  restoreSession: vi.fn(async () => undefined),
};

vi.mock('@/store/auth', () => {
  const useAuthStore = Object.assign(
    (selector: (state: typeof authState) => unknown) => selector(authState),
    {
      setState: (patch: Partial<typeof authState>) => Object.assign(authState, patch),
    }
  );
  return { useAuthStore };
});

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ restoreSession: vi.fn(async () => undefined) });
});

it('refreshes the session so onboarding can land on the dashboard', () => {
  const tree = render(
    <OnboardingDoneScreen
      navigation={{} as any}
      route={{
        key: 'OnboardingDone',
        name: 'OnboardingDone',
        params: { workspaceName: 'Acme Operations' },
      }}
    />
  );

  expect(textContent(tree.root)).toContain('You are in.');
  expect(authState.restoreSession).toHaveBeenCalled();
});
