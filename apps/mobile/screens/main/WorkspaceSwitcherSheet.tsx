import { useState } from 'react';
import { RefreshControl, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { EmptyState } from '@/components/EmptyState';
import { ListRow } from '@/components/ListRow';
import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { AppText } from '@/components/ui/Text';
import type { RootStackParamList } from '@/navigation/types';
import { useAuthStore } from '@/store/auth';
import { apiErrorCode, humanizeError } from '@/utils/errors';

type Props = NativeStackScreenProps<RootStackParamList, 'WorkspaceSwitcher'>;

export function WorkspaceSwitcherSheet({ navigation }: Props) {
  const workspaces = useAuthStore((state) => state.workspaces);
  const currentWorkspaceId = useAuthStore((state) => state.currentWorkspaceId);
  const refreshWorkspaces = useAuthStore((state) => state.refreshWorkspaces);
  const switchWorkspace = useAuthStore((state) => state.switchWorkspace);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function select(workspaceId: string) {
    await switchWorkspace(workspaceId);
    navigation.goBack();
  }

  async function refresh() {
    setRefreshing(true);
    setError(null);
    try {
      await refreshWorkspaces();
    } catch (err) {
      setError(apiErrorCode(err));
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <Screen
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}>
      <AppText variant="eyebrow" tone="faint" weight="medium">
        Workspaces
      </AppText>
      <AppText variant="title" style={{ marginTop: 4 }}>
        Switch brain
      </AppText>
      <View className="mt-6">
        {error ? (
          <EmptyState
            title="Could not refresh workspaces."
            body={humanizeError(error)}
            action={
              <Button size="sm" variant="secondary" onPress={() => void refresh()}>
                Retry
              </Button>
            }
          />
        ) : workspaces.length === 0 ? (
          <EmptyState
            title="No workspaces yet."
            body="Create a workspace or accept an invite to connect this app to a company brain."
          />
        ) : (
          workspaces.map((workspace) => (
            <ListRow
              key={workspace.id}
              title={workspace.name}
              subtitle={`${workspace.role ?? 'member'} · ${workspace.status}`}
              meta={workspace.id === currentWorkspaceId ? 'current' : undefined}
              onPress={() => void select(workspace.id)}
            />
          ))
        )}
      </View>
      <View className="mt-6 gap-3">
        <Button variant="secondary" onPress={() => navigation.navigate('OnboardingWorkspace')}>
          Create workspace
        </Button>
        <Button variant="ghost" onPress={() => navigation.navigate('InviteAccept', {})}>
          Accept invite
        </Button>
      </View>
    </Screen>
  );
}
