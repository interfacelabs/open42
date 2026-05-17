import { useEffect, useState } from 'react';
import { View } from 'react-native';
import * as Linking from 'expo-linking';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { AppText } from '@/components/ui/Text';
import { TextField } from '@/components/ui/TextField';
import { useAuthStore } from '@/store/auth';
import { apiFetch } from '@/utils/api';
import {
  verificationParamsFromParams,
  verificationParamsFromUrl,
  type VerificationParams,
} from '@/utils/deepLinks';
import { apiErrorCode, humanizeError } from '@/utils/errors';
import type { RootStackParamList } from '@/navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'VerifyDeepLink'>;

export function VerifyDeepLinkScreen({ route }: Props) {
  const restoreSession = useAuthStore((state) => state.restoreSession);
  const [params, setParams] = useState<VerificationParams>(() =>
    verificationParamsFromParams(route.params)
  );
  const [manualUrl, setManualUrl] = useState('');
  const [status, setStatus] = useState<'idle' | 'verifying' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    void Linking.getInitialURL().then((url) => {
      if (!mounted || !url) return;
      setParams((current) => ({ ...verificationParamsFromUrl(url), ...current }));
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const routeParams = verificationParamsFromParams(route.params);
    setParams((current) => ({ ...current, ...routeParams }));
  }, [route.params]);

  useEffect(() => {
    if (hasVerificationPayload(params)) void verify(params);
    // Run when the params payload first becomes actionable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.token, params.tokenHash, params.accessToken]);

  async function verify(payload = params) {
    if (!hasVerificationPayload(payload) || status === 'verifying') return;
    setStatus('verifying');
    setError(null);
    try {
      await apiFetch('/auth/verify', {
        method: 'POST',
        body: {
          email: payload.email,
          token: payload.token,
          tokenHash: payload.tokenHash,
          accessToken: payload.accessToken,
          type: payload.type ?? 'email',
          inviteId: payload.inviteId,
        },
      });
      await restoreSession();
    } catch (err) {
      setError(apiErrorCode(err));
      setStatus('error');
    }
  }

  function parseManualUrl() {
    const parsed = verificationParamsFromUrl(manualUrl);
    setParams(parsed);
    void verify(parsed);
  }

  return (
    <Screen>
      <View className="pt-20">
        <AppText variant="eyebrow" tone="faint" weight="medium">
          Magic link
        </AppText>
        <AppText variant="title" style={{ marginTop: 10 }}>
          Checking your sign-in link.
        </AppText>
        <AppText variant="muted" tone="subtle" style={{ marginTop: 10 }}>
          If the link carried a code, verification starts automatically.
        </AppText>
        {error ? (
          <AppText variant="caption" tone="error" style={{ marginTop: 16 }}>
            {humanizeError(error)}
          </AppText>
        ) : null}
        <View className="mt-8 gap-3">
          <TextField
            value={manualUrl}
            placeholder="Paste magic link"
            autoCapitalize="none"
            onChangeText={setManualUrl}
          />
          <Button loading={status === 'verifying'} onPress={parseManualUrl}>
            {status === 'verifying' ? 'Checking' : 'Verify link'}
          </Button>
        </View>
      </View>
    </Screen>
  );
}

function hasVerificationPayload(params: VerificationParams): boolean {
  return Boolean(params.token || params.tokenHash || params.accessToken);
}
