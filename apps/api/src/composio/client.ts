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
    initiate(p: Record<string, unknown>): Promise<unknown>;
    get(id: string): Promise<unknown>;
    delete(id: string): Promise<unknown>;
  };
  tools: {
    execute(tool: string, p: Record<string, unknown>): Promise<unknown>;
  };
}

type ComposioConstructor = new (opts: Record<string, unknown>) => ComposioSdk;

export async function createComposioClient(deps: ComposioClientDeps): Promise<ComposioClient> {
  if (!deps.apiKey) {
    throw new Error('createComposioClient: apiKey required');
  }
  const packageName = '@composio/core';
  const mod = (await import(packageName)) as {
    Composio?: ComposioConstructor;
    default?: { Composio?: ComposioConstructor };
  };
  const Composio = mod.Composio ?? mod.default?.Composio;
  if (!Composio) {
    throw new Error('@composio/core: Composio export not found - SDK shape may have changed');
  }
  const sdk = new Composio({ apiKey: deps.apiKey, baseURL: deps.baseUrl });

  return {
    async initiateConnection(p) {
      const res = await sdk.connectedAccounts.initiate({
        userId: p.user_id,
        appName: p.app,
        redirectUri: p.redirect_uri,
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
      const res = await sdk.tools.execute(p.tool, {
        connectedAccountId: p.account,
        arguments: p.args,
      });
      return res as T;
    },
  };
}

export function noopComposioStub(): ComposioClient {
  const fail = async (): Promise<never> => {
    throw new Error('composio_not_configured');
  };
  return {
    initiateConnection: fail,
    getConnection: fail,
    deleteConnection: fail,
    executeTool: fail,
  };
}

function stringField(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = (value as Record<string, unknown>)[key];
  return typeof raw === 'string' ? raw : undefined;
}
