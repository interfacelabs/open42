export type WorkspaceRole = 'owner' | 'admin' | 'member';
export type WorkspaceStatus = 'provisioning' | 'ready' | 'failed';
export type WorkspacePlan = 'starter' | 'team' | 'business';
export type WorkspaceRuntime = 'provisioning' | 'overdue' | 'ready' | 'failed';

export interface UserSummary {
  id: string;
  email: string;
  currentWorkspaceId?: string | null;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  role?: WorkspaceRole;
  status: WorkspaceStatus;
}

export interface CurrentWorkspace {
  id: string;
  name: string;
  plan: WorkspacePlan | null;
  status: WorkspaceStatus | string;
  gbrainReady: boolean;
  runtime: WorkspaceRuntime;
  lastError: string | null;
  provisionAttempts: number;
  provisioningStartedAt: string;
  createdAt: string;
}

export interface WorkspaceInviteSummary {
  id: string;
  email: string;
  status: 'pending' | 'accepted' | 'revoked' | string;
  createdAt?: string;
}

export interface WorkspaceConnectionSummary {
  id: string;
  kind: string;
  status: string;
  displayName: string;
}

export interface IngestJobSummary {
  id: string;
  status: string;
  pagesTotal: number;
  createdAt: string;
}

export interface WorkspaceCurrentPayload {
  user: UserSummary;
  workspace: CurrentWorkspace | null;
  invites: WorkspaceInviteSummary[];
  connections: WorkspaceConnectionSummary[];
  lastJob: IngestJobSummary | null;
  requiresProviderKeys: boolean;
  providerKeys: {
    anthropicChat: boolean;
    openaiEmbed: boolean;
  };
}

export type LlmProvider = 'openai' | 'anthropic';
export type LlmScope = 'chat' | 'embed';

export interface WorkspaceCredentialEntry {
  provider: LlmProvider;
  scope: LlmScope;
  model?: string | null;
  createdAt: string;
}

export interface WorkspaceCredentialsPayload {
  credentials: WorkspaceCredentialEntry[];
}

export interface Citation {
  index: number;
  slug: string;
  version_id: number | null;
  last_updated: string | null;
  excerpt: string;
  source_id?: string | null;
  source_status?: string | null;
  source_label?: string | null;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  citations?: Citation[];
  error?: string;
  retryQuery?: string;
}

export type SkillRevisionRole = 'you' | 'brain';

export interface SkillRevision {
  id: string;
  role: SkillRevisionRole;
  text: string;
  cites?: string;
}

export interface SkillCite {
  index: number;
  slug: string;
  lastUpdated?: string;
}

export interface SkillDraft {
  id: string;
  name: string;
  version: string;
  body: string;
  explainer?: string | null;
  cites: SkillCite[];
  revisions: SkillRevision[];
  unsaved?: boolean;
  staleness?: {
    changelog: string;
    detectedAt: string;
  } | null;
}

export interface SkillSummary {
  id: string;
  name: string;
  version: string | null;
  updatedAt: string;
  staleness?: {
    changelog: string;
    detectedAt: string;
  } | null;
}

export interface ShareLinkResult {
  url: string;
  expiresAt: string;
  publicKeyUrl?: string;
}

export interface Member {
  userId: string;
  email: string;
  role: WorkspaceRole;
  joinedAt: string;
}

export interface Invite {
  id: string;
  email: string;
  role: 'admin' | 'member';
  status: 'pending' | 'accepted' | 'revoked';
  createdAt: string;
}

export interface McpClient {
  id: string;
  label: string;
  scopes: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface McpProxyStatus {
  enabled: boolean;
  available: boolean;
  issuerUrl: string | null;
  mcpUrl: string | null;
  role?: WorkspaceRole;
  myClient?: McpClient | null;
  clients: McpClient[];
}

export interface McpCreatedClient {
  client: McpClient;
  clientId: string;
  clientSecret: string;
  scope: string;
  grantType: string;
  issuerUrl: string;
  tokenUrl: string;
  mcpUrl: string;
}
