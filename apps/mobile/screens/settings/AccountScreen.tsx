import { View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { Card } from '@/components/Card';
import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { AppText } from '@/components/ui/Text';
import type { RootStackParamList } from '@/navigation/types';
import { useAuthStore } from '@/store/auth';

type Props = NativeStackScreenProps<RootStackParamList, 'Account'>;

export function AccountScreen({ navigation }: Props) {
  const user = useAuthStore((state) => state.user);
  return (
    <Screen>
      <AppText variant="eyebrow" tone="faint" weight="medium">
        Account
      </AppText>
      <AppText variant="title" style={{ marginTop: 4 }}>
        Signed in as
      </AppText>
      <Card style={{ marginTop: 18 }}>
        <AppText variant="body" weight="medium">
          {user?.email ?? 'Unknown email'}
        </AppText>
        <AppText variant="mono" tone="faint" style={{ marginTop: 6 }}>
          {user?.id ?? 'no session'}
        </AppText>
      </Card>
      <View className="mt-6">
        <Button variant="secondary" onPress={() => navigation.navigate('SignOut')}>
          Sign out
        </Button>
      </View>
    </Screen>
  );
}
