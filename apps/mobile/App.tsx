import './global.css';
/* eslint-disable import/no-duplicates */
import 'react-native-gesture-handler';

import { useEffect, useMemo } from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { Geist_400Regular } from '@expo-google-fonts/geist/400Regular';
import { Geist_500Medium } from '@expo-google-fonts/geist/500Medium';
import { Geist_600SemiBold } from '@expo-google-fonts/geist/600SemiBold';
import { GeistMono_400Regular } from '@expo-google-fonts/geist-mono/400Regular';
import { GeistMono_500Medium } from '@expo-google-fonts/geist-mono/500Medium';
import type { Theme } from '@react-navigation/native';

import Navigation from './navigation';
import { useAuthStore } from './store/auth';
import { setUnauthorizedHandler } from './utils/api';
import { colors } from './utils/theme';

export default function App() {
  const restoreSession = useAuthStore((state) => state.restoreSession);
  const signOutLocal = useAuthStore((state) => state.signOutLocal);
  const [fontsLoaded] = useFonts({
    Geist_400Regular,
    Geist_500Medium,
    Geist_600SemiBold,
    GeistMono_400Regular,
    GeistMono_500Medium,
  });
  const theme = useMemo<Theme>(
    () => ({
      dark: false,
      colors: {
        primary: colors.textPrimary,
        background: colors.bg,
        card: colors.surface,
        text: colors.textPrimary,
        border: colors.border,
        notification: colors.accent,
      },
      fonts: {
        regular: { fontFamily: 'Geist_400Regular', fontWeight: '400' },
        medium: { fontFamily: 'Geist_500Medium', fontWeight: '500' },
        bold: { fontFamily: 'Geist_600SemiBold', fontWeight: '600' },
        heavy: { fontFamily: 'Geist_600SemiBold', fontWeight: '600' },
      },
    }),
    []
  );
  useEffect(() => {
    setUnauthorizedHandler(() => {
      void signOutLocal();
    });
    void restoreSession();
    return () => setUnauthorizedHandler(null);
  }, [restoreSession, signOutLocal]);

  if (!fontsLoaded) return <View style={{ backgroundColor: colors.bg, flex: 1 }} />;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <Navigation theme={theme} />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
