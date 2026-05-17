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

type Props = NativeStackScreenProps<RootStackParamList, 'OnboardingInvites'>;

export function OnboardingInvitesScreen({ navigation, route }: Props) {
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const emails = useMemo(
    () =>
      Array.from(
        new Set(
          text
            .split(/[\s,;]+/)
            .map((item) => item.trim().toLowerCase())
            .filter(Boolean)
        )
      ),
    [text]
  );

  async function submit(skip = false) {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch('/workspaces/onboarding/invites', {
        method: 'POST',
        body: { emails: skip ? [] : emails },
      });
      navigation.navigate('OnboardingDone', { workspaceName: route.params.workspaceName });
    } catch (err) {
      setError(apiErrorCode(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen>
      <View className="pt-16">
        <AppText variant="eyebrow" tone="faint" weight="medium">
          Invites
        </AppText>
        <AppText variant="title" style={{ marginTop: 10 }}>
          Bring teammates into {route.params.workspaceName}.
        </AppText>
        <AppText variant="muted" tone="subtle" style={{ marginTop: 10 }}>
          Add emails separated by commas or new lines. You can skip this and invite from settings.
        </AppText>
        <View className="mt-8 gap-3">
          <TextField
            value={text}
            placeholder="ana@company.com, tom@company.com"
            multiline
            numberOfLines={5}
            style={{ minHeight: 130, paddingTop: 14, textAlignVertical: 'top' }}
            onChangeText={setText}
          />
          <AppText variant="caption" tone="faint">
            {emails.length} pending invite{emails.length === 1 ? '' : 's'}
          </AppText>
          <Button loading={submitting} onPress={() => void submit(false)}>
            {submitting ? 'Sending' : 'Send invites'}
          </Button>
          <Button variant="secondary" onPress={() => void submit(true)}>
            Skip for now
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
