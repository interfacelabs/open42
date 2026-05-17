import { NavigationContainer, type Theme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Home, MessageSquare, Sparkles } from 'lucide-react-native';

import { AppText } from '@/components/ui/Text';
import { SignInScreen } from '@/screens/auth/SignInScreen';
import { VerifyDeepLinkScreen } from '@/screens/auth/VerifyDeepLinkScreen';
import { InviteAcceptScreen } from '@/screens/invite/InviteAcceptScreen';
import { ChatScreen } from '@/screens/main/ChatScreen';
import { DashboardScreen } from '@/screens/main/DashboardScreen';
import { SkillDetailScreen } from '@/screens/main/SkillDetailScreen';
import { SkillsListScreen } from '@/screens/main/SkillsListScreen';
import { WorkspaceSwitcherSheet } from '@/screens/main/WorkspaceSwitcherSheet';
import { OnboardingDoneScreen } from '@/screens/onboarding/OnboardingDoneScreen';
import { OnboardingInvitesScreen } from '@/screens/onboarding/OnboardingInvitesScreen';
import { OnboardingWorkspaceScreen } from '@/screens/onboarding/OnboardingWorkspaceScreen';
import { AccountScreen } from '@/screens/settings/AccountScreen';
import { ApiKeysScreen } from '@/screens/settings/ApiKeysScreen';
import { ConnectionsScreen } from '@/screens/settings/ConnectionsScreen';
import { McpScreen } from '@/screens/settings/McpScreen';
import { MembersScreen } from '@/screens/settings/MembersScreen';
import { PlanScreen } from '@/screens/settings/PlanScreen';
import { SettingsHomeScreen } from '@/screens/settings/SettingsHomeScreen';
import { SignOutScreen } from '@/screens/settings/SignOutScreen';
import { useAuthStore } from '@/store/auth';
import { linking } from '@/utils/deepLinks';
import { colors, fonts } from '@/utils/theme';

import type { MainTabParamList, RootStackParamList } from './types';

const RootStack = createNativeStackNavigator<RootStackParamList>();
const Tabs = createBottomTabNavigator<MainTabParamList>();

interface NavigationProps {
  theme: Theme;
}

export default function Navigation({ theme }: NavigationProps) {
  const hydrated = useAuthStore((state) => state.hydrated);
  const user = useAuthStore((state) => state.user);
  const currentWorkspaceId = useAuthStore((state) => state.currentWorkspaceId);

  if (!hydrated) {
    return (
      <AppText variant="caption" tone="faint" style={{ marginTop: 80, textAlign: 'center' }}>
        restoring session
      </AppText>
    );
  }

  return (
    <NavigationContainer linking={linking} theme={theme}>
      <RootStack.Navigator screenOptions={screenOptions}>
        {!user ? (
          <>
            <RootStack.Screen
              name="SignIn"
              component={SignInScreen}
              options={{ headerShown: false }}
            />
            <RootStack.Screen
              name="VerifyDeepLink"
              component={VerifyDeepLinkScreen}
              options={{ title: 'Verify' }}
            />
            <RootStack.Screen
              name="InviteAccept"
              component={InviteAcceptScreen}
              options={{ title: 'Invite' }}
            />
          </>
        ) : !currentWorkspaceId ? (
          <>
            <RootStack.Screen
              name="OnboardingWorkspace"
              component={OnboardingWorkspaceScreen}
              options={{ headerShown: false }}
            />
            <RootStack.Screen
              name="OnboardingInvites"
              component={OnboardingInvitesScreen}
              options={{ title: 'Invite teammates' }}
            />
            <RootStack.Screen
              name="OnboardingDone"
              component={OnboardingDoneScreen}
              options={{ headerShown: false }}
            />
            <RootStack.Screen
              name="InviteAccept"
              component={InviteAcceptScreen}
              options={{ title: 'Invite' }}
            />
          </>
        ) : (
          <>
            <RootStack.Screen name="Main" component={MainTabs} options={{ headerShown: false }} />
            <RootStack.Screen
              name="SkillDetail"
              component={SkillDetailScreen}
              options={({ route }) => ({ title: route.params.skillName ?? 'Skill' })}
            />
            <RootStack.Screen
              name="WorkspaceSwitcher"
              component={WorkspaceSwitcherSheet}
              options={{
                animation: 'slide_from_bottom',
                presentation: 'modal',
                title: 'Workspaces',
              }}
            />
            <RootStack.Screen
              name="SettingsHome"
              component={SettingsHomeScreen}
              options={{ title: 'Settings' }}
            />
            <RootStack.Screen
              name="Account"
              component={AccountScreen}
              options={{ title: 'Account' }}
            />
            <RootStack.Screen
              name="Members"
              component={MembersScreen}
              options={{ title: 'Members' }}
            />
            <RootStack.Screen name="Mcp" component={McpScreen} options={{ title: 'MCP' }} />
            <RootStack.Screen
              name="ApiKeys"
              component={ApiKeysScreen}
              options={{ title: 'API keys' }}
            />
            <RootStack.Screen name="Plan" component={PlanScreen} options={{ title: 'Plan' }} />
            <RootStack.Screen
              name="Connections"
              component={ConnectionsScreen}
              options={{ title: 'Connections' }}
            />
            <RootStack.Screen
              name="SignOut"
              component={SignOutScreen}
              options={{ headerShown: false }}
            />
            <RootStack.Screen
              name="InviteAccept"
              component={InviteAcceptScreen}
              options={{ title: 'Invite' }}
            />
            <RootStack.Screen
              name="OnboardingWorkspace"
              component={OnboardingWorkspaceScreen}
              options={{ title: 'Create workspace' }}
            />
            <RootStack.Screen
              name="OnboardingInvites"
              component={OnboardingInvitesScreen}
              options={{ title: 'Invite teammates' }}
            />
            <RootStack.Screen
              name="OnboardingDone"
              component={OnboardingDoneScreen}
              options={{ headerShown: false }}
            />
          </>
        )}
      </RootStack.Navigator>
    </NavigationContainer>
  );
}

function MainTabs() {
  return (
    <Tabs.Navigator
      screenOptions={{
        animation: 'fade',
        headerShown: false,
        tabBarActiveTintColor: colors.textPrimary,
        tabBarInactiveTintColor: colors.textFaint,
        tabBarLabelStyle: {
          fontFamily: fonts.sansMedium,
          fontSize: 11,
        },
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
        },
      }}>
      <Tabs.Screen
        name="HomeTab"
        component={DashboardScreen}
        options={{
          title: 'Home',
          tabBarIcon: ({ color }) => <Home color={color} size={18} strokeWidth={1.5} />,
        }}
      />
      <Tabs.Screen
        name="ChatTab"
        component={ChatScreen}
        options={{
          title: 'Chat',
          tabBarIcon: ({ color }) => <MessageSquare color={color} size={18} strokeWidth={1.5} />,
        }}
      />
      <Tabs.Screen
        name="SkillsTab"
        component={SkillsListScreen}
        options={{
          title: 'Skills',
          tabBarIcon: ({ color }) => <Sparkles color={color} size={18} strokeWidth={1.5} />,
        }}
      />
    </Tabs.Navigator>
  );
}

const screenOptions = {
  animation: 'fade_from_bottom' as const,
  animationDuration: 180,
  contentStyle: { backgroundColor: colors.bg },
  headerBackTitleVisible: false,
  headerShadowVisible: false,
  headerStyle: { backgroundColor: colors.surface },
  headerTintColor: colors.textBody,
  headerTitleStyle: {
    color: colors.textPrimary,
    fontFamily: fonts.sansMedium,
    fontSize: 15,
    fontWeight: '500' as const,
  },
};
