import { RefreshControl, View } from 'react-native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { Settings, UsersRound } from 'lucide-react-native';

import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { ListRow } from '@/components/ListRow';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { AppText } from '@/components/ui/Text';
import { useCurrentWorkspace, useSkills } from '@/hooks/useWorkspaceData';
import type { MainTabParamList, RootStackParamList } from '@/navigation/types';
import { useAuthStore } from '@/store/auth';
import { useChatStore } from '@/store/chat';
import { formatRelativeDate } from '@/utils/dates';
import { apiErrorCode, humanizeError } from '@/utils/errors';
import { colors } from '@/utils/theme';
import type { CompositeScreenProps } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

type Props = CompositeScreenProps<
  BottomTabScreenProps<MainTabParamList, 'HomeTab'>,
  NativeStackScreenProps<RootStackParamList>
>;

export function DashboardScreen({ navigation }: Props) {
  const currentWorkspaceId = useAuthStore((state) => state.currentWorkspaceId);
  const current = useAuthStore((state) => state.current);
  const workspaces = useAuthStore((state) => state.workspaces);
  const refreshCurrent = useAuthStore((state) => state.refreshCurrent);
  const refreshWorkspaces = useAuthStore((state) => state.refreshWorkspaces);
  const { error: currentError, isValidating, mutate } = useCurrentWorkspace();
  const { error: skillsError, skills, mutate: mutateSkills } = useSkills(currentWorkspaceId);
  const messages = useChatStore((state) => state.messages);
  const recentAssistant = [...messages].reverse().find((message) => message.role === 'assistant');
  const workspace = current?.workspace;

  async function refresh() {
    await Promise.all([mutate(), mutateSkills(), refreshCurrent(), refreshWorkspaces()]);
  }

  return (
    <Screen
      refreshControl={
        <RefreshControl refreshing={isValidating} onRefresh={() => void refresh()} />
      }>
      <View className="flex-row items-center justify-between">
        <View className="min-w-0 flex-1">
          <AppText variant="eyebrow" tone="faint" weight="medium">
            Home
          </AppText>
          <AppText variant="title" numberOfLines={1} style={{ marginTop: 4 }}>
            {workspace?.name ?? 'Open42'}
          </AppText>
        </View>
        <View className="flex-row gap-2">
          <Button
            size="sm"
            variant="secondary"
            onPress={() => navigation.navigate('WorkspaceSwitcher')}>
            {workspaces.length > 1 ? 'Switch' : 'Workspace'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={<Settings color={colors.textBody} size={16} strokeWidth={1.5} />}
            onPress={() => navigation.navigate('SettingsHome')}>
            Settings
          </Button>
        </View>
      </View>

      <View className="mt-6 gap-3">
        {currentError || skillsError ? (
          <Card>
            <EmptyState
              title="Could not refresh workspace data."
              body={humanizeError(apiErrorCode(currentError ?? skillsError))}
              action={
                <Button size="sm" variant="secondary" onPress={() => void refresh()}>
                  Retry
                </Button>
              }
            />
          </Card>
        ) : null}

        <Card>
          <View className="flex-row items-start justify-between gap-3">
            <View className="flex-1">
              <AppText variant="section">Brain status</AppText>
              <AppText variant="muted" tone="subtle" style={{ marginTop: 6 }}>
                {workspace?.runtime === 'ready'
                  ? 'Ready to answer with citations.'
                  : workspace?.runtime === 'failed'
                    ? 'Provisioning needs attention.'
                    : 'Provisioning in the background.'}
              </AppText>
            </View>
            <StatusBadge
              label={workspace?.runtime ?? 'no workspace'}
              tone={
                workspace?.runtime === 'ready'
                  ? 'success'
                  : workspace?.runtime === 'failed'
                    ? 'error'
                    : 'neutral'
              }
            />
          </View>
          <View className="mt-4 gap-2">
            <Metric label="sources" value={String(current?.connections?.length ?? 0)} />
            <Metric label="skills" value={String(skills.length)} />
            <Metric label="invites" value={String(current?.invites?.length ?? 0)} />
          </View>
        </Card>

        <Card>
          <AppText variant="section">Recent chat</AppText>
          {recentAssistant ? (
            <ListRow
              title={recentAssistant.text || 'Answer in progress'}
              subtitle={`${recentAssistant.citations?.length ?? 0} cited sources`}
              onPress={() => navigation.navigate('ChatTab')}
            />
          ) : (
            <EmptyState
              title="No questions yet."
              body="Ask the brain from the Chat tab. The answer will keep its citation receipts."
              action={
                <Button
                  size="sm"
                  variant="secondary"
                  onPress={() => navigation.navigate('ChatTab')}>
                  Ask the brain
                </Button>
              }
            />
          )}
        </Card>

        <Card>
          <AppText variant="section">Recent skills</AppText>
          {skills.length > 0 ? (
            skills
              .slice(0, 3)
              .map((skill) => (
                <ListRow
                  key={skill.id}
                  title={skill.name}
                  subtitle={skill.staleness?.changelog ?? 'Signed skill bundle'}
                  meta={skill.version ? `v${skill.version}` : undefined}
                  right={skill.staleness ? <StatusBadge label="stale" tone="warning" /> : undefined}
                  onPress={() =>
                    navigation.navigate('SkillDetail', { skillId: skill.id, skillName: skill.name })
                  }
                />
              ))
          ) : (
            <EmptyState
              title="No skills exported yet."
              body="Skills show up here after the brain turns a sourced thread into an artifact."
            />
          )}
        </Card>

        <Card>
          <View className="flex-row items-center gap-3">
            <UsersRound color={colors.textFaint} size={18} strokeWidth={1.5} />
            <View className="flex-1">
              <AppText variant="body" weight="medium">
                Last ingest
              </AppText>
              <AppText variant="caption" tone="subtle">
                {current?.lastJob
                  ? `${current.lastJob.status} · ${formatRelativeDate(current.lastJob.createdAt)}`
                  : 'No ingest jobs yet'}
              </AppText>
            </View>
          </View>
        </Card>
      </View>
    </Screen>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-center justify-between rounded-md bg-surface-muted px-3 py-2">
      <AppText variant="caption" tone="faint">
        {label}
      </AppText>
      <AppText variant="section">{value}</AppText>
    </View>
  );
}
