import { randomUUID } from 'node:crypto';

import { recordMcpCall } from '../audit/mcp.js';
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
  /**
   * Identifier of the user whose request triggered this gbrain call.
   * `null` (or unset) flags a system-driven call (scheduler, ingest worker,
   * provisioning) — those still write to `mcp_audit_log` but with
   * `caller_user_id IS NULL`. See Codex review #6.
   */
  callerUserId?: string | null;
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

/**
 * Structured error from a gbrain HTTP/MCP call.
 *
 * IMPORTANT (Codex review #2): do NOT add fields that carry upstream response
 * bodies, request arguments, or tool inputs. gbrain is upstream code we do
 * not audit and may echo arbitrary tool args back in error payloads — those
 * must never reach our persistent application logs. Fields here are limited to:
 *   - `status`     — HTTP status of the upstream call
 *   - `code`       — JSON-RPC error code if surfaced by gbrain
 *   - `bodyLength` — size of the upstream response body in bytes (triage only)
 * The full message string is intentionally short and never includes upstream
 * body text. Anything richer belongs in a debug-only path that does NOT log.
 */
export interface GbrainErrorMeta {
  /** JSON-RPC error code if surfaced by gbrain. */
  code?: number | string;
  /** Length of the upstream response body — kept for triage, NOT the body itself. */
  bodyLength?: number;
}

export class GbrainHttpError extends Error {
  readonly code?: number | string;
  readonly bodyLength?: number;
  constructor(
    message: string,
    readonly status?: number,
    meta: GbrainErrorMeta = {},
  ) {
    super(message);
    this.name = 'GbrainHttpError';
    this.code = meta.code;
    this.bodyLength = meta.bodyLength;
  }
}

export class GbrainClient {
  private readonly fetchImpl: Fetch;
  private readonly now: () => number;
  private readonly baseUrl: string;
  private readonly callerUserId: string | null;

  constructor(
    private readonly workspace: GbrainWorkspaceConfig,
    deps: GbrainClientDeps = {},
  ) {
    this.fetchImpl = deps.fetch ?? fetch;
    this.now = deps.now ?? Date.now;
    this.baseUrl = workspace.baseUrl.replace(/\/+$/, '');
    this.callerUserId = deps.callerUserId ?? null;
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

  async listPages(
    params: {
      type?: string;
      tag?: string;
      limit?: number;
      include_deleted?: boolean;
    } = {},
  ): Promise<unknown> {
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
    const { payload } = await this.readJsonResponse(response, 'get_health');
    return payload;
  }

  async getStats(): Promise<unknown> {
    return this.callTool('get_stats', {});
  }

  async callTool<T = unknown>(name: string, args: Record<string, unknown>): Promise<T> {
    const requestId = randomUUID();
    const startedAt = Date.now();
    let status = 0;
    let resultCount: number | null = null;
    let errorCode: string | null = null;
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/mcp`, {
        method: 'POST',
        headers: {
          Accept: 'application/json, text/event-stream',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${await this.getAccessToken()}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: requestId,
          method: 'tools/call',
          params: { name, arguments: args },
        }),
      });
      status = response.status;

      const { payload, bodyLength } = await this.readJsonResponse(response, name);
      if (payload.error) {
        const rawCode = rawErrorCode(payload.error);
        errorCode = rawCode !== undefined ? String(rawCode) : null;
        throw new GbrainHttpError(`gbrain ${name} failed`, response.status, {
          code: rawCode,
          bodyLength,
        });
      }

      const result = payload.result ?? payload;
      if (result?.isError) {
        const rawCode = rawErrorCode(result);
        errorCode = rawCode !== undefined ? String(rawCode) : 'tool_error';
        throw new GbrainHttpError(`gbrain ${name} returned an error`, response.status, {
          code: rawCode,
          bodyLength,
        });
      }

      const text = result?.content?.[0]?.text;
      let parsed: unknown = result;
      if (typeof text === 'string') {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = text;
        }
      }
      resultCount = extractResultCount(parsed);
      return parsed as T;
    } catch (err) {
      if (status === 0 && err instanceof GbrainHttpError && typeof err.status === 'number') {
        status = err.status;
      }
      if (errorCode === null) {
        errorCode = err instanceof Error ? err.name : 'unknown_error';
      }
      throw err;
    } finally {
      // Fire-and-forget: never await, never throw, never block the user.
      void recordMcpCall({
        workspaceId: this.workspace.workspaceId,
        callerUserId: this.callerUserId,
        toolName: name,
        requestArgs: args,
        requestId,
        status,
        durationMs: Date.now() - startedAt,
        resultCount,
        errorCode,
      });
    }
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
    const { payload: token, bodyLength: tokenBodyLength } = await this.readJsonResponse(
      response,
      'token',
    );
    if (typeof token.access_token !== 'string') {
      throw new GbrainHttpError('gbrain token response missing access_token', response.status, {
        bodyLength: tokenBodyLength,
      });
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

  private async readJsonResponse(
    response: Response,
    operation: string,
  ): Promise<{ payload: any; bodyLength: number }> {
    const text = await response.text();
    const bodyLength = text.length;
    const payload = parseMcpHttpPayload(text);
    if (!response.ok) {
      throw new GbrainHttpError(`gbrain ${operation} HTTP ${response.status}`, response.status, {
        bodyLength,
      });
    }
    return { payload, bodyLength };
  }
}

/**
 * Best-effort row count from a gbrain response. Returns null when the shape
 * doesn't carry a list — audit row records `resultCount IS NULL`, which the
 * column already nullable supports. Never throws.
 */
function extractResultCount(value: unknown): number | null {
  if (!value || typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;
  for (const key of ['chunks', 'results', 'items', 'pages', 'versions'] as const) {
    const arr = obj[key];
    if (Array.isArray(arr)) return arr.length;
  }
  return null;
}

function rawErrorCode(value: unknown): number | string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const obj = value as Record<string, unknown>;
  if (typeof obj.code === 'number' || typeof obj.code === 'string') return obj.code;
  if (typeof obj.error_code === 'string') return obj.error_code;
  if (typeof obj.errorCode === 'string') return obj.errorCode;
  return undefined;
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
  return registerGbrainOAuthClientWithOptions(baseUrl, {
    clientName: 'open42',
    grantTypes: ['client_credentials'],
    redirectUris: [],
    scope: 'read write admin',
    tokenEndpointAuthMethod: 'client_secret_post',
    fetchImpl,
  });
}

export async function registerGbrainOAuthClientWithOptions(
  baseUrl: string,
  options: {
    clientName: string;
    grantTypes: string[];
    redirectUris: string[];
    scope: string;
    tokenEndpointAuthMethod?: string;
    fetchImpl?: Fetch;
  },
): Promise<{ client_id: string; client_secret: string }> {
  const root = baseUrl.replace(/\/+$/, '');
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(`${root}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: options.clientName,
      grant_types: options.grantTypes,
      redirect_uris: options.redirectUris,
      scope: options.scope,
      token_endpoint_auth_method: options.tokenEndpointAuthMethod ?? 'client_secret_post',
    }),
  });
  const text = await response.text();
  const bodyLength = text.length;
  let payload: Partial<{ client_id: string; client_secret: string }> = {};
  try {
    payload = text
      ? (JSON.parse(text) as Partial<{ client_id: string; client_secret: string }>)
      : {};
  } catch {
    // Leave payload empty — body content must NOT be attached to the error.
  }
  if (
    !response.ok ||
    typeof payload.client_id !== 'string' ||
    typeof payload.client_secret !== 'string'
  ) {
    throw new GbrainHttpError('gbrain OAuth client registration failed', response.status, {
      bodyLength,
    });
  }
  return { client_id: payload.client_id, client_secret: payload.client_secret };
}
