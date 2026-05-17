import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  Cable,
  CreditCard,
  KeyRound,
  LogOut,
  PlugZap,
  UserRound,
  UsersRound,
} from 'lucide-react-native';

import { ListRow } from '@/components/ListRow';
import { Screen } from '@/components/ui/Screen';
import { AppText } from '@/components/ui/Text';
import type { RootStackParamList } from '@/navigation/types';
import { colors } from '@/utils/theme';

type Props = NativeStackScreenProps<RootStackParamList, 'SettingsHome'>;

export function SettingsHomeScreen({ navigation }: Props) {
  return (
    <Screen>
      <AppText variant="eyebrow" tone="faint" weight="medium">
        Settings
      </AppText>
      <AppText variant="title" style={{ marginTop: 4 }}>
        Workspace controls
      </AppText>
      <ListRow
        title="Account"
        subtitle="Email and sign out"
        icon={<UserRound color={colors.textSubtle} size={16} strokeWidth={1.5} />}
        onPress={() => navigation.navigate('Account')}
      />
      <ListRow
        title="Members"
        subtitle="Members and pending invites"
        icon={<UsersRound color={colors.textSubtle} size={16} strokeWidth={1.5} />}
        onPress={() => navigation.navigate('Members')}
      />
      <ListRow
        title="API keys"
        subtitle="Manage provider keys"
        icon={<KeyRound color={colors.textSubtle} size={16} strokeWidth={1.5} />}
        onPress={() => navigation.navigate('ApiKeys')}
      />
      <ListRow
        title="MCP"
        subtitle="Connect MCP-compatible agents"
        icon={<Cable color={colors.textSubtle} size={16} strokeWidth={1.5} />}
        onPress={() => navigation.navigate('Mcp')}
      />
      <ListRow
        title="Plan"
        subtitle="Workspace plan and limits"
        icon={<CreditCard color={colors.textSubtle} size={16} strokeWidth={1.5} />}
        onPress={() => navigation.navigate('Plan')}
      />
      <ListRow
        title="Connections"
        subtitle="Source connectors are desktop-first in P1"
        icon={<PlugZap color={colors.textSubtle} size={16} strokeWidth={1.5} />}
        onPress={() => navigation.navigate('Connections')}
      />
      <ListRow
        title="Sign out"
        icon={<LogOut color={colors.textSubtle} size={16} strokeWidth={1.5} />}
        onPress={() => navigation.navigate('SignOut')}
      />
    </Screen>
  );
}
