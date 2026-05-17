import { RefreshControl, View } from 'react-native';
import { CreditCard } from 'lucide-react-native';

import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { AppText } from '@/components/ui/Text';
import { useCurrentWorkspace } from '@/hooks/useWorkspaceData';
import { apiErrorCode, humanizeError } from '@/utils/errors';
import { colors } from '@/utils/theme';

export function PlanScreen() {
  const { data, error, isValidating, mutate } = useCurrentWorkspace();
  const workspace = data?.workspace;

  return (
    <Screen
      refreshControl={<RefreshControl refreshing={isValidating} onRefresh={() => void mutate()} />}>
      <AppText variant="eyebrow" tone="faint" weight="medium">
        Plan
      </AppText>
      <AppText variant="title" style={{ marginTop: 4 }}>
        Workspace plan
      </AppText>
      <AppText variant="muted" tone="subtle" style={{ marginTop: 8 }}>
        Billing-sensitive changes stay on desktop. Mobile keeps the current state visible.
      </AppText>

      {error ? (
        <Card style={{ marginTop: 18 }}>
          <EmptyState
            title="Could not load plan."
            body={humanizeError(apiErrorCode(error))}
            action={
              <Button size="sm" variant="secondary" onPress={() => void mutate()}>
                Retry
              </Button>
            }
          />
        </Card>
      ) : (
        <Card style={{ marginTop: 18 }}>
          <View className="flex-row items-start gap-3">
            <View className="h-9 w-9 items-center justify-center rounded-full bg-surface-muted">
              <CreditCard color={colors.textSubtle} size={17} strokeWidth={1.5} />
            </View>
            <View className="flex-1">
              <AppText variant="section">{workspace?.plan ?? 'Starter'}</AppText>
              <AppText variant="caption" tone="subtle" style={{ marginTop: 5 }}>
                {workspace?.name ?? 'Current workspace'}
              </AppText>
            </View>
            <StatusBadge label={workspace?.runtime ?? 'checking'} />
          </View>
          <View className="mt-5 flex-row gap-3">
            <Metric label="sources" value={String(data?.connections.length ?? 0)} />
            <Metric label="invites" value={String(data?.invites.length ?? 0)} />
          </View>
          <View className="mt-5">
            <AppText variant="caption" tone="subtle">
              Provider keys: Anthropic chat {data?.providerKeys.anthropicChat ? 'set' : 'unset'}
              {' · '}OpenAI embed {data?.providerKeys.openaiEmbed ? 'set' : 'unset'}
            </AppText>
          </View>
        </Card>
      )}
    </Screen>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-1">
      <AppText variant="caption" tone="faint">
        {label}
      </AppText>
      <AppText variant="section" style={{ marginTop: 4 }}>
        {value}
      </AppText>
    </View>
  );
}
