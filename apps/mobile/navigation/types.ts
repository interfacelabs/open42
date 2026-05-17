import type { VerificationParams } from '@/utils/deepLinks';

export type RootStackParamList = {
  SignIn: undefined;
  VerifyDeepLink: VerificationParams | undefined;
  OnboardingWorkspace: undefined;
  OnboardingInvites: { workspaceName: string };
  OnboardingDone: { workspaceName: string };
  Main: undefined;
  SkillDetail: { skillId: string; skillName?: string };
  WorkspaceSwitcher: undefined;
  SettingsHome: undefined;
  Account: undefined;
  Members: undefined;
  Mcp: undefined;
  ApiKeys: undefined;
  Plan: undefined;
  Connections: undefined;
  SignOut: undefined;
  InviteAccept: {
    inviteId?: string;
    tokenHash?: string;
    accessToken?: string;
    type?: string;
    workspaceName?: string;
    inviterEmail?: string;
  };
};

export type MainTabParamList = {
  HomeTab: undefined;
  ChatTab: { skillId?: string; skillName?: string } | undefined;
  SkillsTab: undefined;
};
