import { randomUUID } from 'node:crypto';

import { decryptSecret } from '../crypto/envelope.js';

type Fetch = typeof fetch;

export interface GbrainWorkspaceConfig {
  workspaceId: string;
  baseUrl: string;
  oauthClientId: string;
  oauthClientSecretCiphertext?: Buffer | Uint8Array | string | null;
  oauthClientSecret?: string;
}

export interface GbrainClientDeps {
  fetch?: Fetch;
  now?: () => number;
}

export interface TokenCacheEntry {
  accessToken: string;
  expiresAtMs: number;
}

export interface GbrainCitationChunk {
  slug?: string;
  version_id?: number;
  last_updated?: string;
  excerpt?: string;
  chunk_text?: string;
  score?: number;
  [key: string]: unknown;
}

export interface GbrainQueryResult {
  chunks?: GbrainCitationChunk[];
  results?: GbrainCitationChunk[];
  answer?: string;
  [key: string]: unknown;
}

const tokenCache = new Map<string, TokenCacheEntry>();

export function clearGbrainTokenCache(): void {
  tokenCache.clear();
}

export class GbrainHttpError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'GbrainHttpError';
  }
}

export class GbrainClient {
  private readonly fetchImpl: Fetch;
  private readonly now: () => number;
  private readonly baseUrl: string;

  constructor(
    private readonly workspace: GbrainWorkspaceConfig,
    deps: GbrainClientDeps = {},
  ) {
    this.fetchImpl = deps.fetch ?? fetch;
    this.now = deps.now ?? Date.now;
    this.baseUrl = workspace.baseUrl.replace(/\/+$/, '');
  }

  async putPage(slug: string, content: string): Promise<unknown> {
    return this.callTool('put_page', { slug, content });
  }

  async query(params: {
    query: string;
    limit?: number;
    offset?: number;
    expand?: boolean;
    detail?: string;
  }): Promise<GbrainQueryResult> {
    return this.callTool<GbrainQueryResult>('query', params);
  }

  async getChunks(slug: string): Promise<GbrainCitationChunk[]> {
    const result = await this.callTool<unknown>('get_chunks', { slug });
    return Array.isArray(result) ? (result as GbrainCitationChunk[]) : [];
  }

  async getVersions(slug: string): Promise<unknown> {
    return this.callTool('get_versions', { slug });
  }

  async listPages(params: {
    type?: string;
    tag?: string;
    limit?: number;
    include_deleted?: boolean;
  } = {}): Promise<unknown> {
    return this.callTool('list_pages', params);
  }

  async submitJob(name: string, params: Record<string, unknown>): Promise<unknown> {
    return this.callTool('submit_job', { name, data: params });
  }

  async getJobProgress(id: number | string): Promise<unknown> {
    return this.callTool('get_job_progress', { id: Number(id) });
  }

  async getHealth(): Promise<{ version?: string; status?: string; [key: string]: unknown }> {
    const response = await this.fetchImpl(`${this.baseUrl}/health`, {
      headers: { Authorization: `Bearer ${await this.getAccessToken()}` },
    });
    return this.readJsonResponse(response, 'get_health');
  }

  async getStats(): Promise<unknown> {
    return this.callTool('get_stats', {});
  }

  async callTool<T = unknown>(name: string, args: Record<string, unknown>): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        Accept: 'application/json, text/event-stream',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${await this.getAccessToken()}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: randomUUID(),
        method: 'tools/call',
        params: { name, arguments: args },
      }),
    });

    const payload = await this.readJsonResponse(response, name);
    if (payload.error) {
      throw new GbrainHttpError(`gbrain ${name} failed`, response.status, payload.error);
    }

    const result = payload.result ?? payload;
    if (result?.isError) {
      throw new GbrainHttpError(`gbrain ${name} returned an error`, response.status, result);
    }

    const text = result?.content?.[0]?.text;
    if (typeof text === 'string') {
      try {
        return JSON.parse(text) as T;
      } catch {
        return text as T;
      }
    }

    return result as T;
  }

  async getAccessToken(): Promise<string> {
    const cached = tokenCache.get(this.workspace.workspaceId);
    if (cached && cached.expiresAtMs > this.now()) {
      return cached.accessToken;
    }

    const secret = this.workspace.oauthClientSecret ?? this.decryptWorkspaceSecret();
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.workspace.oauthClientId,
      client_secret: secret,
      scope: 'read write admin',
    });

    const response = await this.fetchImpl(`${this.baseUrl}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const token = await this.readJsonResponse(response, 'token');
    if (typeof token.access_token !== 'string') {
      throw new GbrainHttpError('gbrain token response missing access_token', response.status, token);
    }

    const expiresIn = Number(token.expires_in ?? 3600);
    tokenCache.set(this.workspace.workspaceId, {
      accessToken: token.access_token,
      expiresAtMs: this.now() + Math.max(0, expiresIn - 60) * 1000,
    });
    return token.access_token;
  }

  private decryptWorkspaceSecret(): string {
    const ciphertext = this.workspace.oauthClientSecretCiphertext;
    if (!ciphertext) {
      throw new GbrainHttpError('workspace is missing encrypted gbrain client secret');
    }
    return decryptSecret(ciphertext, {
      workspaceId: this.workspace.workspaceId,
      purpose: 'gbrain_oauth_secret',
    });
  }

  private async readJsonResponse(response: Response, operation: string): Promise<any> {
    const text = await response.text();
    const payload = parseMcpHttpPayload(text);
    if (!response.ok) {
      throw new GbrainHttpError(`gbrain ${operation} HTTP ${response.status}`, response.status, payload);
    }
    return payload;
  }
}

export function parseMcpHttpPayload(text: string): any {
  const trimmed = text.trim();
  if (!trimmed) return {};
  if (trimmed.includes('data:')) {
    const data = trimmed
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .filter(Boolean)
      .at(-1);
    return data ? JSON.parse(data) : {};
  }
  return JSON.parse(trimmed);
}

export async function registerGbrainOAuthClient(
  baseUrl: string,
  fetchImpl: Fetch = fetch,
): Promise<{ client_id: string; client_secret: string }> {
  const root = baseUrl.replace(/\/+$/, '');
  const response = await fetchImpl(`${root}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'open42',
      grant_types: ['client_credentials'],
      redirect_uris: [],
      scope: 'read write admin',
      token_endpoint_auth_method: 'client_secret_post',
    }),
  });
  const payload = (await response.json()) as Partial<{
    client_id: string;
    client_secret: string;
  }>;
  if (!response.ok || typeof payload.client_id !== 'string' || typeof payload.client_secret !== 'string') {
    throw new GbrainHttpError('gbrain OAuth client registration failed', response.status, payload);
  }
  return { client_id: payload.client_id, client_secret: payload.client_secret };
}
