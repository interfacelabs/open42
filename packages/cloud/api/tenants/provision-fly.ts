import type { TenantProvisionerOptions, TenantRuntime } from '@open42/api/tenants/provision';

type Fetch = typeof fetch;

interface FlyTenantProvisionEnv {
  FLY_API_TOKEN?: string;
  FLY_TENANTS_APP_NAME?: string;
  GBRAIN_TENANT_REGION?: string;
  GBRAIN_TENANT_VOLUME_SIZE_GB?: string;
  GBRAIN_TENANT_IMAGE?: string;
  GBRAIN_POSTGRES_DB?: string;
  GBRAIN_POSTGRES_PASSWORD?: string;
  GBRAIN_POSTGRES_USER?: string;
  OPEN42_API_FLYCAST_HOST?: string;
}

export async function createFlyTenant(options: TenantProvisionerOptions): Promise<TenantRuntime> {
  const env = options.env as FlyTenantProvisionEnv;
  const token = required(env.FLY_API_TOKEN, 'FLY_API_TOKEN');
  const appName = required(env.FLY_TENANTS_APP_NAME, 'FLY_TENANTS_APP_NAME');
  const region = env.GBRAIN_TENANT_REGION;
  const volume = await createFlyVolume({
    appName,
    fetch: options.fetch,
    workspaceId: options.workspaceId,
    region,
    sizeGb: Number(env.GBRAIN_TENANT_VOLUME_SIZE_GB ?? 3),
    token,
  });
  const machine = await createFlyMachine({
    appName,
    token,
    image: tenantImage(env, options.gbrainVersion),
    gbrainVersion: options.gbrainVersion,
    workspaceId: options.workspaceId,
    postgresDb: env.GBRAIN_POSTGRES_DB ?? 'gbrain',
    postgresPassword: env.GBRAIN_POSTGRES_PASSWORD,
    postgresUser: env.GBRAIN_POSTGRES_USER ?? 'gbrain',
    open42ApiBaseUrl: flyOpen42ApiBaseUrl(env),
    proxyToken: options.proxyToken,
    region,
    fetch: options.fetch,
    volumeId: volume.id,
  });
  return {
    tenantRuntimeId: machine.id,
    gbrainPrivateAddress: machine.privateIp,
    gbrainBaseUrl: formatGbrainBaseUrl(machine.privateIp),
  };
}

async function createFlyVolume(options: {
  appName: string;
  token: string;
  workspaceId: string;
  region?: string;
  sizeGb: number;
  fetch: Fetch;
}): Promise<{ id: string }> {
  const response = await options.fetch(
    `https://api.machines.dev/v1/apps/${options.appName}/volumes`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${options.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: tenantVolumeName(options.workspaceId),
        region: options.region,
        size_gb: options.sizeGb,
      }),
    },
  );
  const payload = (await response.json()) as Partial<{ id: string }>;
  if (!response.ok) {
    throw new Error(`Fly volume create failed: ${JSON.stringify(payload)}`);
  }
  const id = String(payload.id ?? '');
  if (!id) {
    throw new Error('Fly volume response missing id');
  }
  return { id };
}

async function createFlyMachine(options: {
  appName: string;
  token: string;
  image: string;
  gbrainVersion: string;
  workspaceId: string;
  open42ApiBaseUrl: string;
  postgresDb: string;
  postgresPassword?: string;
  postgresUser: string;
  proxyToken: string;
  region?: string;
  fetch: Fetch;
  volumeId: string;
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
        name: `open42-${options.workspaceId.slice(0, 8)}`,
        region: options.region,
        skip_launch: false,
        config: {
          image: options.image,
          env: {
            GBRAIN_HOME: '/data/gbrain',
            GBRAIN_POSTGRES_DB: options.postgresDb,
            ...(options.postgresPassword
              ? { GBRAIN_POSTGRES_PASSWORD: options.postgresPassword }
              : {}),
            GBRAIN_POSTGRES_USER: options.postgresUser,
            GBRAIN_VERSION: options.gbrainVersion,
            OPENAI_API_KEY: options.proxyToken,
            OPENAI_BASE_URL: `${options.open42ApiBaseUrl}/proxy/openai/v1`,
            ANTHROPIC_API_KEY: options.proxyToken,
            ANTHROPIC_BASE_URL: `${options.open42ApiBaseUrl}/proxy/anthropic`,
          },
          guest: {
            cpu_kind: 'shared',
            cpus: 1,
            memory_mb: 1024,
          },
          mounts: [
            {
              path: '/data',
              volume: options.volumeId,
            },
          ],
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

function flyOpen42ApiBaseUrl(env: { OPEN42_API_FLYCAST_HOST?: string }): string {
  const host = env.OPEN42_API_FLYCAST_HOST ?? 'open42-api.flycast';
  const withProtocol = /^https?:\/\//.test(host) ? host : `http://${host}`;
  return withProtocol.replace(/\/+$/, '');
}

function tenantImage(env: { GBRAIN_TENANT_IMAGE?: string }, gbrainVersion: string): string {
  return env.GBRAIN_TENANT_IMAGE ?? `open42/gbrain-tenant:v${gbrainVersion}`;
}

function formatGbrainBaseUrl(privateIp: string): string {
  if (/^https?:\/\//.test(privateIp)) return privateIp.replace(/\/+$/, '');
  const host = privateIp.includes(':') && !privateIp.startsWith('[') ? `[${privateIp}]` : privateIp;
  return `http://${host}:8080`;
}

function tenantVolumeName(workspaceId: string): string {
  const suffix =
    workspaceId
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 16) || 'tenant';
  return `open42_gbrain_${suffix}`.slice(0, 30);
}

function required(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}
