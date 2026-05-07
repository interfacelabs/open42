import type {
  ComposioClient,
  ComposioConnection,
  ExecuteToolParams,
  InitiateConnectionParams,
  InitiateConnectionResult,
} from './client.js';

export interface FakeComposioOptions {
  seedConnections?: ComposioConnection[];
  toolHandlers?: Record<string, (p: ExecuteToolParams) => Promise<unknown>>;
}

export interface FakeComposioClient extends ComposioClient {
  accounts: Map<string, ComposioConnection>;
  recordedInitiates: InitiateConnectionParams[];
  recordedExecutes: ExecuteToolParams[];
  recordedDeletes: string[];
  recordedGets: string[];
}

export function createFakeComposio(opts: FakeComposioOptions = {}): FakeComposioClient {
  const accounts = new Map<string, ComposioConnection>();
  for (const c of opts.seedConnections ?? []) accounts.set(c.id, c);
  const recordedInitiates: InitiateConnectionParams[] = [];
  const recordedExecutes: ExecuteToolParams[] = [];
  const recordedDeletes: string[] = [];
  const recordedGets: string[] = [];
  let nextId = 1;

  return {
    accounts,
    recordedInitiates,
    recordedExecutes,
    recordedDeletes,
    recordedGets,
    async initiateConnection(p: InitiateConnectionParams): Promise<InitiateConnectionResult> {
      recordedInitiates.push(p);
      const id = `fake-pending-${nextId++}`;
      accounts.set(id, { id, status: 'INITIATED', user_id: p.user_id, app: p.app });
      return {
        redirect_url: `https://composio.fake/oauth?state=${id}`,
        pending_connected_account_id: id,
      };
    },
    async getConnection(id: string): Promise<ComposioConnection> {
      recordedGets.push(id);
      const c = accounts.get(id);
      if (!c) throw new Error(`fake composio: unknown account ${id}`);
      return c;
    },
    async deleteConnection(id: string): Promise<void> {
      recordedDeletes.push(id);
      accounts.delete(id);
    },
    async executeTool<T>(p: ExecuteToolParams): Promise<T> {
      recordedExecutes.push(p);
      const handler = opts.toolHandlers?.[p.tool];
      if (!handler) throw new Error(`fake composio: no handler for tool ${p.tool}`);
      return (await handler(p)) as T;
    },
  };
}

export function activateFakeAccount(
  fake: FakeComposioClient,
  id: string,
  patch?: Partial<ComposioConnection>,
): void {
  const c = fake.accounts.get(id);
  if (!c) throw new Error(`unknown fake account ${id}`);
  fake.accounts.set(id, { ...c, status: 'ACTIVE', ...patch });
}
