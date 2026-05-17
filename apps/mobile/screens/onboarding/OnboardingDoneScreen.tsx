import { useEffect } from 'react';
import { View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { AppText } from '@/components/ui/Text';
import { useAuthStore } from '@/store/auth';
import type { RootStackParamList } from '@/navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'OnboardingDone'>;

export function OnboardingDoneScreen({ route }: Props) {
  const restoreSession = useAuthStore((state) => state.restoreSession);

  useEffect(() => {
    void restoreSession();
  }, [restoreSession]);

  return (
    <Screen scroll={false}>
      <View className="flex-1 justify-center">
        <AppText variant="eyebrow" tone="faint" weight="medium">
          Ready
        </AppText>
        <AppText variant="display" style={{ marginTop: 12 }}>
          You are in.
        </AppText>
        <AppText variant="muted" tone="subtle" style={{ marginTop: 12 }}>
          {route.params.workspaceName} is now available on mobile and web. The dashboard will show
          what the brain knows and what still needs sources.
        </AppText>
        <View className="mt-8">
          <Button onPress={() => void restoreSession()}>Open dashboard</Button>
        </View>
      </View>
    </Screen>
  );
}
