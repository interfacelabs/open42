import { useState } from 'react';
import { View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { AppText } from '@/components/ui/Text';
import { useAuthStore } from '@/store/auth';

export function SignOutScreen() {
  const signOutRemote = useAuthStore((state) => state.signOutRemote);
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    setSigningOut(true);
    await signOutRemote();
  }

  return (
    <Screen scroll={false}>
      <View className="flex-1 justify-center">
        <AppText variant="eyebrow" tone="faint" weight="medium">
          Sign out
        </AppText>
        <AppText variant="title" style={{ marginTop: 10 }}>
          End this Open42 session?
        </AppText>
        <AppText variant="muted" tone="subtle" style={{ marginTop: 10 }}>
          This clears the mobile cookie jar and returns to sign-in.
        </AppText>
        <View className="mt-8">
          <Button variant="danger" loading={signingOut} onPress={() => void signOut()}>
            {signingOut ? 'Signing out' : 'Sign out'}
          </Button>
        </View>
      </View>
    </Screen>
  );
}
