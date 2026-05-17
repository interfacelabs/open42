import { useMemo, useState } from 'react';
import { View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { AppText } from '@/components/ui/Text';
import { TextField } from '@/components/ui/TextField';
import { apiFetch } from '@/utils/api';
import { apiErrorCode, humanizeError } from '@/utils/errors';
import type { RootStackParamList } from '@/navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'OnboardingWorkspace'>;

export function OnboardingWorkspaceScreen({ navigation }: Props) {
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const slug = useMemo(
    () =>
      name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 40),
    [name]
  );

  async function submit() {
    if (!name.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch('/workspaces/onboarding/workspace', {
        method: 'POST',
        body: { name: name.trim() },
      });
      navigation.navigate('OnboardingInvites', { workspaceName: name.trim() });
    } catch (err) {
      setError(apiErrorCode(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen scroll={false}>
      <View className="flex-1 justify-center">
        <AppText variant="eyebrow" tone="faint" weight="medium">
          Workspace
        </AppText>
        <AppText variant="display" style={{ marginTop: 12 }}>
          Name the brain.
        </AppText>
        <AppText variant="muted" tone="subtle" style={{ marginTop: 12 }}>
          This is the workspace your team will see across web and mobile.
        </AppText>
        <View className="mt-8 gap-3">
          <TextField value={name} placeholder="Acme Operations" onChangeText={setName} />
          <AppText variant="mono" tone="faint">
            {slug ? `/${slug}` : '/workspace-slug'}
          </AppText>
          <Button loading={submitting} onPress={() => void submit()}>
            {submitting ? 'Creating' : 'Create workspace'}
          </Button>
          {error ? (
            <AppText variant="caption" tone="error">
              {humanizeError(error)}
            </AppText>
          ) : null}
        </View>
      </View>
    </Screen>
  );
}
