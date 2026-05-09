export type ComposioConnectionStatus = 'INITIATED' | 'ACTIVE' | 'EXPIRED' | 'FAILED';

export interface ComposioConnection {
  id: string;
  status: ComposioConnectionStatus;
  user_id: string;
  app: string;
}

export interface InitiateConnectionParams {
  user_id: string;
  app: string;
  auth_config_id: string;
  redirect_uri: string;
}

export interface InitiateConnectionResult {
  redirect_url: string;
  pending_connected_account_id: string;
}

export interface ExecuteToolParams {
  tool: string;
  account: string;
  args: Record<string, unknown>;
}

export interface ComposioClient {
  initiateConnection(p: InitiateConnectionParams): Promise<InitiateConnectionResult>;
  getConnection(id: string): Promise<ComposioConnection>;
  deleteConnection(id: string): Promise<void>;
  executeTool<T>(p: ExecuteToolParams): Promise<T>;
}

export interface ComposioClientDeps {
  apiKey: string;
  baseUrl?: string;
}

interface ComposioSdk {
  connectedAccounts: {
    link(
      userId: string,
      authConfigId: string,
      options?: { callbackUrl?: string },
    ): Promise<unknown>;
    get(id: string): Promise<unknown>;
    delete(id: string): Promise<unknown>;
  };
  tools: {
    execute(tool: string, p: Record<string, unknown>): Promise<unknown>;
  };
}

type ComposioConstructor = new (opts: Record<string, unknown>) => ComposioSdk;
type ComposioModule = {
  Composio?: ComposioConstructor;
  default?: { Composio?: ComposioConstructor };
};

export async function createComposioClient(deps: ComposioClientDeps): Promise<ComposioClient> {
  if (!deps.apiKey) {
    throw new Error('createComposioClient: apiKey required');
  }
  const packageName = '@composio/core';
  // TODO(P1): restore @composio/core in apps/api/package.json and package-lock.json
  // once installation is available. Until then, keep the dynamic import non-fatal so
  // the API can boot and non-Composio ingestion paths continue to work.
  const mod = await loadComposioSdk(packageName);
  if (!mod) {
    return noopComposioStub(
      'composio_sdk_unavailable: install @composio/core and restore the package-lock entry',
    );
  }
  const Composio = mod.Composio ?? mod.default?.Composio;
  if (!Composio) {
    throw new Error('@composio/core: Composio export not found - SDK shape may have changed');
  }
  const sdk = new Composio({ apiKey: deps.apiKey, baseURL: deps.baseUrl });

  return {
    async initiateConnection(p) {
      const res = await sdk.connectedAccounts.link(p.user_id, p.auth_config_id, {
        callbackUrl: p.redirect_uri,
      });
      const redirect_url = stringField(res, 'redirectUrl') ?? stringField(res, 'redirect_url') ?? '';
      const pending_connected_account_id =
        stringField(res, 'connectedAccountId') ?? stringField(res, 'id') ?? '';
      if (!redirect_url || !pending_connected_account_id) {
        throw new Error('Composio initiateConnection returned unexpected shape');
      }
      return { redirect_url, pending_connected_account_id };
    },
    async getConnection(id) {
      const res = await sdk.connectedAccounts.get(id);
      return {
        id: stringField(res, 'id') ?? '',
        status: (stringField(res, 'status') ?? 'FAILED') as ComposioConnectionStatus,
        user_id: stringField(res, 'userId') ?? stringField(res, 'user_id') ?? '',
        app: stringField(res, 'appName') ?? stringField(res, 'app') ?? '',
      };
    },
    async deleteConnection(id) {
      await sdk.connectedAccounts.delete(id);
    },
    async executeTool<T>(p: ExecuteToolParams): Promise<T> {
      const max = 5;
      let delay = 500;
      for (let attempt = 0; attempt < max; attempt += 1) {
        try {
          const res = await sdk.tools.execute(p.tool, {
            connectedAccountId: p.account,
            arguments: p.args,
          });
          return res as T;
        } catch (err) {
          // TODO(P1): Spike 3 has not manually validated Composio's rate-limit error
          // shape; this retry handles plausible HTTP 429 shapes only.
          if (!isRateLimitError(err) || attempt === max - 1) throw err;
          await sleep(delay + Math.random() * 250);
          delay *= 2;
        }
      }
      throw new Error('unreachable');
    },
  };
}

export function noopComposioStub(reason = 'composio_not_configured'): ComposioClient {
  const fail = async (): Promise<never> => {
    throw new Error(reason);
  };
  return {
    initiateConnection: fail,
    getConnection: fail,
    deleteConnection: fail,
    executeTool: fail,
  };
}

async function loadComposioSdk(packageName: string): Promise<ComposioModule | null> {
  try {
    return (await import(packageName)) as ComposioModule;
  } catch (err) {
    if (isMissingPackage(err, packageName)) return null;
    throw err;
  }
}

// TODO(P1): replace response shape probing with @composio/core SDK types after the
// SDK dependency is restored to the lockfile.
function stringField(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = (value as Record<string, unknown>)[key];
  return typeof raw === 'string' ? raw : undefined;
}

function isRateLimitError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const record = err as Record<string, unknown>;
  const response = record.response;
  const responseStatus =
    response && typeof response === 'object'
      ? (response as Record<string, unknown>).status
      : undefined;
  return record.status === 429 || record.statusCode === 429 || responseStatus === 429;
}

function isMissingPackage(err: unknown, packageName: string): boolean {
  if (!err || typeof err !== 'object') return false;
  const record = err as { code?: unknown; message?: unknown };
  return record.code === 'ERR_MODULE_NOT_FOUND' && String(record.message ?? '').includes(packageName);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
