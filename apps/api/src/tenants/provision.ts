import { eq } from 'drizzle-orm';
import { execFile as execFileCallback } from 'node:child_process';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { encryptSecret } from '../crypto/envelope.js';
import { db as defaultDb, schema } from '../db/client.js';
import { GbrainClient, registerGbrainOAuthClient } from '../gbrain/client.js';
import { assertGbrainVersion } from '../gbrain/version-check.js';

type Fetch = typeof fetch;
const execFile = promisify(execFileCallback);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

export interface TenantProvisionEnv {
  TENANT_PROVISIONER?: string;
  FLY_API_TOKEN?: string;
  FLY_TENANTS_APP_NAME?: string;
  GBRAIN_VERSION?: string;
  GBRAIN_TENANT_IMAGE?: string;
  GBRAIN_LOCAL_PORT_START?: string;
}

export interface TenantProvisionRepo {
  createWorkspace(input: {
    ownerUserId: string;
    flyMachineId: string;
    flyPrivateIp: string;
    gbrainBaseUrl: string;
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
  runCommand?: CommandRunner;
  allocatePort?: (startAt: number) => Promise<number>;
  sleep?: (ms: number) => Promise<void>;
}

export interface ProvisionTenantResult {
  workspaceId: string;
  flyMachineId: string;
  flyPrivateIp: string;
  gbrainBaseUrl: string;
}

type CommandRunner = (
  file: string,
  args: string[],
) => Promise<{ stdout: string; stderr: string }>;

export async function provisionTenant(
  options: ProvisionTenantOptions,
): Promise<ProvisionTenantResult> {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetch ?? fetch;
  const repo = options.repo ?? createDrizzleTenantRepo();
  const gbrainVersion = required(env.GBRAIN_VERSION ?? '0.27.1', 'GBRAIN_VERSION');
  const provider = selectProvisioner(env);

  const tenant =
    provider === 'fly'
      ? await createFlyTenant({
          env,
          gbrainVersion,
          ownerUserId: options.ownerUserId,
          fetch: fetchImpl,
        })
      : await createLocalDockerTenant({
          env,
          gbrainVersion,
          ownerUserId: options.ownerUserId,
          runCommand: options.runCommand ?? runCommand,
          allocatePort: options.allocatePort ?? allocatePort,
        });

  await waitForGbrainHealth(tenant.gbrainBaseUrl, fetchImpl, options.sleep ?? sleep);
  const oauth = await registerGbrainOAuthClient(tenant.gbrainBaseUrl, fetchImpl);
  await assertGbrainVersion(
    new GbrainClient(
      {
        workspaceId: tenant.machineId,
        baseUrl: tenant.gbrainBaseUrl,
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
    flyMachineId: tenant.machineId,
    flyPrivateIp: tenant.privateIp,
    gbrainBaseUrl: tenant.gbrainBaseUrl,
    gbrainOauthClientId: oauth.client_id,
    gbrainOauthClientSecretCiphertext: encryptedSecret,
    gbrainVersion,
  });

  return {
    workspaceId: workspace.id,
    flyMachineId: tenant.machineId,
    flyPrivateIp: tenant.privateIp,
    gbrainBaseUrl: tenant.gbrainBaseUrl,
  };
}

async function createFlyTenant(options: {
  env: TenantProvisionEnv;
  gbrainVersion: string;
  ownerUserId: string;
  fetch: Fetch;
}): Promise<{ machineId: string; privateIp: string; gbrainBaseUrl: string }> {
  const token = required(options.env.FLY_API_TOKEN, 'FLY_API_TOKEN');
  const appName = required(options.env.FLY_TENANTS_APP_NAME, 'FLY_TENANTS_APP_NAME');
  const machine = await createFlyMachine({
    appName,
    token,
    image: tenantImage(options.env, options.gbrainVersion),
    gbrainVersion: options.gbrainVersion,
    ownerUserId: options.ownerUserId,
    fetch: options.fetch,
  });
  return {
    machineId: machine.id,
    privateIp: machine.privateIp,
    gbrainBaseUrl: formatGbrainBaseUrl(machine.privateIp),
  };
}

async function createFlyMachine(options: {
  appName: string;
  token: string;
  image: string;
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
          image: options.image,
          env: {
            GBRAIN_VERSION: options.gbrainVersion,
          },
          guest: {
            cpu_kind: 'shared',
            cpus: 1,
            memory_mb: 512,
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

async function createLocalDockerTenant(options: {
  env: TenantProvisionEnv;
  gbrainVersion: string;
  ownerUserId: string;
  runCommand: CommandRunner;
  allocatePort: (startAt: number) => Promise<number>;
}): Promise<{ machineId: string; privateIp: string; gbrainBaseUrl: string }> {
  const image = tenantImage(options.env, options.gbrainVersion);
  const containerName = `open42-gbrain-${options.ownerUserId.slice(0, 8)}`;
  const port = await options.allocatePort(Number(options.env.GBRAIN_LOCAL_PORT_START ?? 18080));
  const baseUrl = `http://127.0.0.1:${port}`;
  const volume = `${containerName}-data`;

  await ensureLocalTenantImage(image, options.runCommand);
  await options.runCommand('docker', ['volume', 'create', volume]);
  await options.runCommand('docker', ['rm', '-f', containerName]).catch(() => ({
    stdout: '',
    stderr: '',
  }));
  await options.runCommand('docker', [
    'run',
    '-d',
    '--name',
    containerName,
    '-p',
    `127.0.0.1:${port}:8080`,
    '-e',
    `GBRAIN_PUBLIC_URL=${baseUrl}`,
    '-e',
    `GBRAIN_VERSION=${options.gbrainVersion}`,
    '-v',
    `${volume}:/data`,
    image,
  ]);

  return {
    machineId: containerName,
    privateIp: `127.0.0.1:${port}`,
    gbrainBaseUrl: baseUrl,
  };
}

async function ensureLocalTenantImage(image: string, runCommand: CommandRunner): Promise<void> {
  try {
    await runCommand('docker', ['image', 'inspect', image]);
  } catch {
    await runCommand('docker', ['build', '-f', 'infra/Dockerfile.gbrain-tenant', '-t', image, '.']);
  }
}

async function waitForGbrainHealth(
  baseUrl: string,
  fetchImpl: Fetch,
  sleepImpl: (ms: number) => Promise<void>,
): Promise<void> {
  const deadline = Date.now() + 30_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}/health`);
      if (response.ok) return;
      lastError = await response.text();
    } catch (err) {
      lastError = err;
    }
    await sleepImpl(500);
  }
  throw new Error(`gbrain tenant did not become healthy: ${String(lastError)}`);
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
            gbrainBaseUrl: input.gbrainBaseUrl,
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
  if (/^https?:\/\//.test(privateIp)) return privateIp.replace(/\/+$/, '');
  if (privateIp.startsWith('127.0.0.1:') || privateIp.startsWith('localhost:')) {
    return `http://${privateIp}`;
  }
  const host = privateIp.includes(':') && !privateIp.startsWith('[') ? `[${privateIp}]` : privateIp;
  return `http://${host}:8080`;
}

function selectProvisioner(env: TenantProvisionEnv): 'fly' | 'local-docker' {
  if (env.TENANT_PROVISIONER === 'fly') return 'fly';
  if (env.TENANT_PROVISIONER === 'local-docker') return 'local-docker';
  if (env.FLY_API_TOKEN && env.FLY_API_TOKEN !== 'fo_...' && env.FLY_TENANTS_APP_NAME) {
    return 'fly';
  }
  return 'local-docker';
}

function tenantImage(env: TenantProvisionEnv, gbrainVersion: string): string {
  return env.GBRAIN_TENANT_IMAGE ?? `open42/gbrain-tenant:v${gbrainVersion}`;
}

async function allocatePort(startAt: number): Promise<number> {
  for (let port = startAt; port < startAt + 100; port += 1) {
    if (await isPortAvailable(port)) return port;
  }
  throw new Error(`no local gbrain port available from ${startAt}`);
}

async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

async function runCommand(file: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  const result = await execFile(file, args, { cwd: repoRoot });
  return {
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function required(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}
