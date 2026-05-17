import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import * as Linking from 'expo-linking';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { AppText } from '@/components/ui/Text';
import { TextField } from '@/components/ui/TextField';
import type { RootStackParamList } from '@/navigation/types';
import { useAuthStore } from '@/store/auth';
import { apiFetch } from '@/utils/api';
import {
  verificationParamsFromParams,
  verificationParamsFromUrl,
  type VerificationParams,
} from '@/utils/deepLinks';
import { apiErrorCode, humanizeError } from '@/utils/errors';

type Props = NativeStackScreenProps<RootStackParamList, 'InviteAccept'>;

export function InviteAcceptScreen({ navigation, route }: Props) {
  const user = useAuthStore((state) => state.user);
  const currentWorkspaceId = useAuthStore((state) => state.currentWorkspaceId);
  const restoreSession = useAuthStore((state) => state.restoreSession);
  const initialParams = verificationParamsFromParams(route.params);
  const [inviteId, setInviteId] = useState(initialParams.inviteId ?? '');
  const [tokenHash, setTokenHash] = useState(initialParams.tokenHash ?? '');
  const [accessToken, setAccessToken] = useState(initialParams.accessToken ?? '');
  const [type, setType] = useState(initialParams.type ?? 'invite');
  const [invitedWorkspaceName, setInvitedWorkspaceName] = useState(
    initialParams.workspaceName ?? ''
  );
  const [inviterEmail, setInviterEmail] = useState(initialParams.inviterEmail ?? '');
  const [status, setStatus] = useState<'idle' | 'accepting' | 'accepted' | 'error'>('idle');
  const [workspaceName, setWorkspaceName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const applyInviteParams = useCallback((params: VerificationParams) => {
    if (params.inviteId) setInviteId(params.inviteId);
    if (params.tokenHash) setTokenHash(params.tokenHash);
    if (params.accessToken) setAccessToken(params.accessToken);
    if (params.type) setType(params.type);
    if (params.workspaceName) setInvitedWorkspaceName(params.workspaceName);
    if (params.inviterEmail) setInviterEmail(params.inviterEmail);
  }, []);

  useEffect(() => {
    let mounted = true;
    void Linking.getInitialURL().then((url) => {
      if (!mounted || !url) return;
      applyInviteParams(verificationParamsFromUrl(url));
    });
    return () => {
      mounted = false;
    };
  }, [applyInviteParams]);

  useEffect(() => {
    applyInviteParams(verificationParamsFromParams(route.params));
  }, [applyInviteParams, route.params]);

  async function accept() {
    if (!inviteId || status === 'accepting') return;
    setStatus('accepting');
    setError(null);
    try {
      if (tokenHash || accessToken) {
        await apiFetch('/auth/verify', {
          method: 'POST',
          body: accessToken ? { inviteId, accessToken } : { inviteId, tokenHash, type },
        });
      } else if (user) {
        const payload = await apiFetch<{ workspace: { name: string } }>(
          `/workspaces/invites/${encodeURIComponent(inviteId)}/accept`,
          { method: 'POST' }
        );
        setWorkspaceName(payload.workspace.name);
      } else {
        setError('magic_link_invalid');
        setStatus('error');
        return;
      }
      await restoreSession();
      setStatus('accepted');
      queueMicrotask(() => {
        navigation.reset({ index: 0, routes: [{ name: 'Main' }] });
      });
    } catch (err) {
      setError(apiErrorCode(err));
      setStatus('error');
    }
  }

  function decline() {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    if (user && currentWorkspaceId) {
      navigation.reset({ index: 0, routes: [{ name: 'Main' }] });
      return;
    }
    if (user) {
      navigation.reset({ index: 0, routes: [{ name: 'OnboardingWorkspace' }] });
      return;
    }
    navigation.reset({ index: 0, routes: [{ name: 'SignIn' }] });
  }

  return (
    <Screen>
      <View className="pt-16">
        <AppText variant="eyebrow" tone="faint" weight="medium">
          Invite
        </AppText>
        <AppText variant="title" style={{ marginTop: 10 }}>
          {status === 'accepted' ? "You're in." : 'Accept workspace invite.'}
        </AppText>
        <AppText variant="muted" tone="subtle" style={{ marginTop: 10 }}>
          {workspaceName
            ? `${workspaceName} is now available in your workspace switcher.`
            : inviteCopy(invitedWorkspaceName, inviterEmail)}
        </AppText>
        <View className="mt-8 gap-3">
          <TextField value={inviteId} placeholder="Invite id" onChangeText={setInviteId} />
          {tokenHash || accessToken ? (
            <AppText variant="caption" tone="faint">
              magic-link token detected
            </AppText>
          ) : null}
          <Button loading={status === 'accepting'} onPress={() => void accept()}>
            {status === 'accepting' ? 'Accepting' : 'Accept invite'}
          </Button>
          <Button variant="secondary" onPress={decline}>
            Decline
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

function inviteCopy(workspaceName: string, inviterEmail: string): string {
  if (workspaceName && inviterEmail) {
    return `${inviterEmail} invited you to ${workspaceName}. Open42 will verify this invite against your signed-in email before adding the workspace.`;
  }
  if (workspaceName) {
    return `You were invited to ${workspaceName}. Open42 will verify this invite against your signed-in email before adding the workspace.`;
  }
  if (inviterEmail) {
    return `${inviterEmail} sent this invite. Open42 will verify it against your signed-in email before adding the workspace.`;
  }
  return 'Open42 will verify this invite against your signed-in email before adding the workspace.';
}
