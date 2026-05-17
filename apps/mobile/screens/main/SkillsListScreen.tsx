import { RefreshControl, View } from 'react-native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { CompositeScreenProps } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Sparkles } from 'lucide-react-native';

import { EmptyState } from '@/components/EmptyState';
import { ListRow } from '@/components/ListRow';
import { StatusBadge } from '@/components/StatusBadge';
import { Screen } from '@/components/ui/Screen';
import { AppText } from '@/components/ui/Text';
import { useSkills } from '@/hooks/useWorkspaceData';
import type { MainTabParamList, RootStackParamList } from '@/navigation/types';
import { useAuthStore } from '@/store/auth';
import { formatRelativeDate } from '@/utils/dates';
import { apiErrorCode, humanizeError } from '@/utils/errors';
import { colors } from '@/utils/theme';

type Props = CompositeScreenProps<
  BottomTabScreenProps<MainTabParamList, 'SkillsTab'>,
  NativeStackScreenProps<RootStackParamList>
>;

export function SkillsListScreen({ navigation }: Props) {
  const workspaceId = useAuthStore((state) => state.currentWorkspaceId);
  const { error, skills, isValidating, mutate } = useSkills(workspaceId);

  return (
    <Screen
      refreshControl={<RefreshControl refreshing={isValidating} onRefresh={() => void mutate()} />}>
      <View className="mb-4">
        <AppText variant="eyebrow" tone="faint" weight="medium">
          Skills
        </AppText>
        <AppText variant="title" style={{ marginTop: 4 }}>
          Exported artifacts
        </AppText>
        <AppText variant="muted" tone="subtle" style={{ marginTop: 8 }}>
          Browse, inspect receipts, and generate share links for desktop install.
        </AppText>
      </View>
      {error ? (
        <EmptyState
          title="Could not load skills."
          body={humanizeError(apiErrorCode(error))}
          action={
            <AppText variant="caption" tone="accent" weight="medium" onPress={() => void mutate()}>
              Retry
            </AppText>
          }
        />
      ) : skills.length === 0 ? (
        <EmptyState
          title="No skills yet."
          body="When a sourced chat becomes operational policy, the exported skill appears here."
        />
      ) : (
        skills.map((skill) => (
          <ListRow
            key={skill.id}
            title={skill.name}
            subtitle={
              skill.staleness?.changelog ?? `Updated ${formatRelativeDate(skill.updatedAt)}`
            }
            icon={<Sparkles color={colors.textSubtle} size={16} strokeWidth={1.5} />}
            meta={skill.version ? `v${skill.version}` : undefined}
            right={skill.staleness ? <StatusBadge label="stale" tone="warning" /> : undefined}
            onPress={() =>
              navigation.navigate('SkillDetail', { skillId: skill.id, skillName: skill.name })
            }
          />
        ))
      )}
    </Screen>
  );
}
