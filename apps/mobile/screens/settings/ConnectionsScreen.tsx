import { RefreshControl, View } from 'react-native';
import { PlugZap } from 'lucide-react-native';

import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { ListRow } from '@/components/ListRow';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { AppText } from '@/components/ui/Text';
import { useCurrentWorkspace } from '@/hooks/useWorkspaceData';
import { apiErrorCode, humanizeError } from '@/utils/errors';
import { colors } from '@/utils/theme';

export function ConnectionsScreen() {
  const { data, error, isValidating, mutate } = useCurrentWorkspace();
  const connections = data?.connections ?? [];

  return (
    <Screen
      refreshControl={<RefreshControl refreshing={isValidating} onRefresh={() => void mutate()} />}>
      <AppText variant="eyebrow" tone="faint" weight="medium">
        Connections
      </AppText>
      <AppText variant="title" style={{ marginTop: 4 }}>
        Source connectors
      </AppText>
      <AppText variant="muted" tone="subtle" style={{ marginTop: 8 }}>
        Mobile shows connected sources. New OAuth and ingest flows stay on desktop in P1.
      </AppText>

      {error ? (
        <Card style={{ marginTop: 18 }}>
          <EmptyState
            title="Could not load connections."
            body={humanizeError(apiErrorCode(error))}
            action={
              <Button size="sm" variant="secondary" onPress={() => void mutate()}>
                Retry
              </Button>
            }
          />
        </Card>
      ) : null}

      <View className="mt-6">
        {connections.length === 0 ? (
          <EmptyState
            eyebrow="DESKTOP"
            title="No sources connected yet."
            body="Connect Notion or another source from the web app, then return here to inspect status."
          />
        ) : (
          connections.map((connection) => (
            <ListRow
              key={connection.id}
              title={connection.displayName}
              subtitle={connection.kind}
              icon={<PlugZap color={colors.textSubtle} size={16} strokeWidth={1.5} />}
              right={<StatusBadge label={connection.status} />}
            />
          ))
        )}
      </View>
    </Screen>
  );
}
