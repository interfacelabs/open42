/**
 * Shared types for the workspace MCP proxy UI.
 *
 * The Open42 web app proxies these payloads through `/api/workspaces/:id/mcp-proxy*`
 * to the backend. Schemas match the spec in
 * `thoughts/2026-05-16/mcp-proxy-onboarding-product-feature-spec.md`.
 */

export interface McpClient {
  id: string;
  label: string;
  scopes: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export type McpRole = 'owner' | 'admin' | 'member';

export interface McpProxyStatus {
  enabled: boolean;
  available: boolean;
  issuerUrl: string | null;
  mcpUrl: string | null;
  /**
   * The caller's role in this workspace. Owners/admins see the toggle and
   * named-client form; members see a single self-claim card and only their
   * own client in the list. Optional so older backends that haven't shipped
   * the role payload still degrade gracefully (treated as 'member').
   */
  role?: McpRole;
  /**
   * The caller's own active client, if any. Lets the UI render the right
   * member-mode CTA (claim vs. already issued) without hunting through
   * `clients`. Null when the member has no active client yet.
   */
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

export type McpProxyManagerMode = 'settings' | 'onboarding';
