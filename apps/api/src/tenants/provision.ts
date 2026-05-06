import { eq } from 'drizzle-orm';

import { encryptSecret } from '../crypto/envelope.js';
import { db as defaultDb, schema } from '../db/client.js';
import { GbrainClient, registerGbrainOAuthClient } from '../gbrain/client.js';
import { assertGbrainVersion } from '../gbrain/version-check.js';

type Fetch = typeof fetch;

export interface TenantProvisionEnv {
  FLY_API_TOKEN?: string;
  FLY_TENANTS_APP_NAME?: string;
  GBRAIN_VERSION?: string;
}

export interface TenantProvisionRepo {
  createWorkspace(input: {
    ownerUserId: string;
    flyMachineId: string;
    flyPrivateIp: string;
    gbrainOauthClientId: string;
    gbrainOauthClientSecretCiphertext: Buffer;
    gbrainVersion: string;
  }): Promise<{ id: string }>;
  markWorkspaceFailed?(workspaceId: string, error: string): Promise<void>;
}

export interface ProvisionTenantOptions {
  ownerUserId: string;
  env?: TenantProvisionEnv;
  fetch?: Fetch;
  repo?: TenantProvisionRepo;
}

export interface ProvisionTenantResult {
  workspaceId: string;
  flyMachineId: string;
  flyPrivateIp: string;
  gbrainBaseUrl: string;
}

export async function provisionTenant(
  options: ProvisionTenantOptions,
): Promise<ProvisionTenantResult> {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetch ?? fetch;
  const repo = options.repo ?? createDrizzleTenantRepo();
  const token = required(env.FLY_API_TOKEN, 'FLY_API_TOKEN');
  const appName = required(env.FLY_TENANTS_APP_NAME, 'FLY_TENANTS_APP_NAME');
  const gbrainVersion = required(env.GBRAIN_VERSION, 'GBRAIN_VERSION');

  const machine = await createFlyMachine({
    appName,
    token,
    gbrainVersion,
    ownerUserId: options.ownerUserId,
    fetch: fetchImpl,
  });
  const gbrainBaseUrl = formatGbrainBaseUrl(machine.privateIp);
  const oauth = await registerGbrainOAuthClient(gbrainBaseUrl, fetchImpl);
  await assertGbrainVersion(
    new GbrainClient(
      {
        workspaceId: machine.id,
        baseUrl: gbrainBaseUrl,
        oauthClientId: oauth.client_id,
        oauthClientSecret: oauth.client_secret,
      },
      { fetch: fetchImpl },
    ),
    gbrainVersion,
  );

  const encryptedSecret = encryptSecret(oauth.client_secret);
  const workspace = await repo.createWorkspace({
    ownerUserId: options.ownerUserId,
    flyMachineId: machine.id,
    flyPrivateIp: machine.privateIp,
    gbrainOauthClientId: oauth.client_id,
    gbrainOauthClientSecretCiphertext: encryptedSecret,
    gbrainVersion,
  });

  return {
    workspaceId: workspace.id,
    flyMachineId: machine.id,
    flyPrivateIp: machine.privateIp,
    gbrainBaseUrl,
  };
}

async function createFlyMachine(options: {
  appName: string;
  token: string;
  gbrainVersion: string;
  ownerUserId: string;
  fetch: Fetch;
}): Promise<{ id: string; privateIp: string }> {
  const response = await options.fetch(
    `https://api.machines.dev/v1/apps/${options.appName}/machines`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${options.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: `open42-${options.ownerUserId.slice(0, 8)}`,
        config: {
          image: `open42/gbrain-tenant:v${options.gbrainVersion}`,
          env: {
            GBRAIN_VERSION: options.gbrainVersion,
          },
          services: [],
        },
      }),
    },
  );
  const payload = (await response.json()) as Partial<{
    id: string;
    private_ip: string;
    privateIp: string;
  }>;
  if (!response.ok) {
    throw new Error(`Fly machine create failed: ${JSON.stringify(payload)}`);
  }

  const id = String(payload.id ?? '');
  const privateIp = String(payload.private_ip ?? payload.privateIp ?? '');
  if (!id || !privateIp) {
    throw new Error('Fly machine response missing id or private_ip');
  }
  return { id, privateIp };
}

function createDrizzleTenantRepo(): TenantProvisionRepo {
  return {
    async createWorkspace(input) {
      return defaultDb.transaction(async (tx) => {
        const [workspace] = await tx
          .insert(schema.workspaces)
          .values({
            ownerUserId: input.ownerUserId,
            flyMachineId: input.flyMachineId,
            flyPrivateIp: input.flyPrivateIp,
            gbrainOauthClientId: input.gbrainOauthClientId,
            gbrainOauthClientSecretCiphertext: input.gbrainOauthClientSecretCiphertext,
            gbrainVersion: input.gbrainVersion,
            status: 'ready',
          })
          .returning({ id: schema.workspaces.id });

        if (!workspace) {
          throw new Error('workspace insert returned no row');
        }

        await tx
          .update(schema.users)
          .set({ currentWorkspaceId: workspace.id })
          .where(eq(schema.users.id, input.ownerUserId));

        await tx.insert(schema.memberships).values({
          userId: input.ownerUserId,
          workspaceId: workspace.id,
          role: 'owner',
        });

        return workspace;
      });
    },
  };
}

function formatGbrainBaseUrl(privateIp: string): string {
  const host = privateIp.includes(':') && !privateIp.startsWith('[') ? `[${privateIp}]` : privateIp;
  return `http://${host}:8080`;
}

function required(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}
