import { and, eq, sql } from 'drizzle-orm';
import { execFile as execFileCallback } from 'node:child_process';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { encryptSecret } from '../crypto/envelope.js';
import { GbrainClient, registerGbrainOAuthClient } from '../gbrain/client.js';
import { assertGbrainVersion } from '../gbrain/version-check.js';
import { generateProxyToken } from '../proxy/token.js';

type Fetch = typeof fetch;
const execFile = promisify(execFileCallback);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

export interface TenantProvisionEnv {
  TENANT_PROVISIONER?: string;
  FLY_API_TOKEN?: string;
  FLY_TENANTS_APP_NAME?: string;
  GBRAIN_GIT_REF?: string;
  GBRAIN_POSTGRES_DB?: string;
  GBRAIN_POSTGRES_PASSWORD?: string;
  GBRAIN_POSTGRES_USER?: string;
  GBRAIN_TENANT_REGION?: string;
  GBRAIN_TENANT_VOLUME_SIZE_GB?: string;
  GBRAIN_VERSION?: string;
  GBRAIN_TENANT_IMAGE?: string;
  GBRAIN_LOCAL_PORT_START?: string;
  API_PORT?: string;
  OPEN42_API_FLYCAST_HOST?: string;
}

export interface TenantProvisionRepo {
  /**
   * Look up an already-provisioned workspace by id. Returning a non-null
   * result short-circuits provisionTenant — used for idempotency on retry
   * (a job re-runs against a row that already finished in a prior attempt).
   */
  findWorkspaceById?(workspaceId: string): Promise<ProvisionTenantResult | null>;
  /**
   * Verify the workspace row exists, is owned by `ownerUserId`, and is not
   * soft-deleted. For legacy callers (dev script) that operate by owner and
   * may not have a row yet, the default Drizzle repo also creates a
   * provisioning row when missing.
   */
  ensureWorkspaceForProvisioning?(
    workspaceId: string,
    ownerUserId: string,
    gbrainVersion: string,
  ): Promise<{ id: string }>;
  /**
   * Advisory lock keyed by workspaceId so retries / concurrent enqueues for
   * the same workspace serialize. Owner-scoped locks broke multi-workspace
   * provisioning — a second workspace for the same owner waited behind the
   * first instead of running independently.
   */
  withWorkspaceProvisioningLock?(
    workspaceId: string,
    provision: () => Promise<ProvisionTenantResult>,
  ): Promise<ProvisionTenantResult>;
  createWorkspace(input: {
    id: string;
    ownerUserId: string;
    flyMachineId: string;
    flyPrivateIp: string;
    gbrainBaseUrl: string;
    gbrainOauthClientId: string;
    gbrainOauthClientSecretCiphertext: Buffer;
    proxyTokenHash: Buffer;
    gbrainVersion: string;
  }): Promise<{ id: string }>;
  markWorkspaceFailedById?(workspaceId: string, errorCode: string): Promise<void>;
  resetWorkspaceById?(workspaceId: string): Promise<void>;
}

export type ProvisioningErrorCode =
  | 'docker_unavailable'
  | 'image_build_failed'
  | 'container_start_failed'
  | 'gbrain_health_timeout'
  | 'oauth_registration_failed'
  | 'gbrain_version_mismatch'
  | 'fly_api_failed'
  | 'provisioning_failed';

export function classifyProvisioningError(err: unknown): ProvisioningErrorCode {
  const message = err instanceof Error ? err.message : String(err ?? '');
  if (
    /docker.*not (running|found)|cannot connect to the docker daemon|enoent.*docker/i.test(message)
  ) {
    return 'docker_unavailable';
  }
  if (/docker build|image inspect|failed to (build|pull) image/i.test(message)) {
    return 'image_build_failed';
  }
  if (/docker run|container.*(failed|exit)/i.test(message)) {
    return 'container_start_failed';
  }
  if (/gbrain tenant did not become healthy/i.test(message)) {
    return 'gbrain_health_timeout';
  }
  if (/oauth|register.*client|client_id|dcr/i.test(message)) {
    return 'oauth_registration_failed';
  }
  if (/version|gbrain.*0\./i.test(message)) {
    return 'gbrain_version_mismatch';
  }
  if (/fly\.io|fly api|fly_api_token/i.test(message)) {
    return 'fly_api_failed';
  }
  return 'provisioning_failed';
}

/**
 * Wrap provisionTenant so async failures land in the DB instead of stdout.
 * On error: marks the workspace `failed` with a stable error code; on success:
 * the existing `createWorkspace` already flips the row to `ready`.
 *
 * Caller still gets the thrown error if they await — but the typical caller
 * fires-and-forgets, so the DB write is the real recovery surface.
 */
export async function safelyProvisionTenant(
  options: ProvisionTenantOptions,
): Promise<ProvisionTenantResult | { error: ProvisioningErrorCode }> {
  const repo = options.repo ?? createDrizzleTenantRepo();
  try {
    return await provisionTenant({ ...options, repo });
  } catch (err) {
    const code = classifyProvisioningError(err);
    try {
      await repo.markWorkspaceFailedById?.(options.workspaceId, code);
    } catch (markErr) {
      // Last-resort: log to stderr. The startup sweep will catch this row eventually.
      console.error('[provision] failed to mark workspace failed', markErr);
    }
    return { error: code };
  }
}

export interface ProvisionTenantOptions {
  /**
   * The workspace row being provisioned. The row is created upfront by the
   * route handler (createWorkspaceForUser / saveWorkspaceName) before the
   * provision job is enqueued. The worker passes both `workspaceId` and
   * `ownerUserId` so provisioning is scoped to *this* workspace — owner
   * scoping silently dropped second-workspace jobs (Chunk-7 codex round-3 P1).
   */
  workspaceId: string;
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

type CommandRunner = (file: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;

export async function provisionTenant(
  options: ProvisionTenantOptions,
): Promise<ProvisionTenantResult> {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetch ?? fetch;
  const repo = options.repo ?? createDrizzleTenantRepo();
  const gbrainVersion = required(env.GBRAIN_VERSION ?? '0.31.3', 'GBRAIN_VERSION');
  const provider = selectProvisioner(env);

  const provision = async (): Promise<ProvisionTenantResult> => {
    const existing = await repo.findWorkspaceById?.(options.workspaceId);
    if (existing) return existing;

    return provisionTenantResources({
      env,
      fetchImpl,
      gbrainVersion,
      ownerUserId: options.ownerUserId,
      workspaceId: options.workspaceId,
      provider,
      repo,
      runCommand: options.runCommand ?? runCommand,
      allocatePort: options.allocatePort ?? allocatePort,
      sleep: options.sleep ?? sleep,
    });
  };

  return repo.withWorkspaceProvisioningLock
    ? repo.withWorkspaceProvisioningLock(options.workspaceId, provision)
    : provision();
}

async function provisionTenantResources(options: {
  env: TenantProvisionEnv;
  fetchImpl: Fetch;
  gbrainVersion: string;
  ownerUserId: string;
  workspaceId: string;
  provider: 'fly' | 'local-docker';
  repo: TenantProvisionRepo;
  runCommand: CommandRunner;
  allocatePort: (startAt: number) => Promise<number>;
  sleep: (ms: number) => Promise<void>;
}): Promise<ProvisionTenantResult> {
  const reservation = await options.repo.ensureWorkspaceForProvisioning?.(
    options.workspaceId,
    options.ownerUserId,
    options.gbrainVersion,
  );
  // ensureWorkspaceForProvisioning returns `{ id }` whose value MUST equal
  // the workspaceId passed in. Tests sometimes return a stub id; honor that
  // for backwards compatibility but treat the option's workspaceId as the
  // canonical identity for resource naming and encryption AAD.
  const workspaceId = reservation?.id ?? options.workspaceId;
  if (!workspaceId) {
    throw new Error('workspace_reservation_required');
  }
  const proxyToken = generateProxyToken(workspaceId);
  const tenant =
    options.provider === 'fly'
      ? await createFlyTenant({
          env: options.env,
          gbrainVersion: options.gbrainVersion,
          workspaceId,
          ownerUserId: options.ownerUserId,
          proxyToken: proxyToken.token,
          fetch: options.fetchImpl,
        })
      : await createLocalDockerTenant({
          env: options.env,
          gbrainVersion: options.gbrainVersion,
          workspaceId,
          ownerUserId: options.ownerUserId,
          proxyToken: proxyToken.token,
          runCommand: options.runCommand,
          allocatePort: options.allocatePort,
        });

  await waitForGbrainHealth(tenant.gbrainBaseUrl, options.fetchImpl, options.sleep);
  const oauth = await registerGbrainOAuthClient(tenant.gbrainBaseUrl, options.fetchImpl);
  await assertGbrainVersion(
    new GbrainClient(
      {
        workspaceId: tenant.machineId,
        baseUrl: tenant.gbrainBaseUrl,
        oauthClientId: oauth.client_id,
        oauthClientSecret: oauth.client_secret,
      },
      { fetch: options.fetchImpl },
    ),
    options.gbrainVersion,
  );

  const encryptedSecret = encryptSecret(oauth.client_secret, {
    workspaceId,
    purpose: 'gbrain_oauth_secret',
  });
  const workspace = await options.repo.createWorkspace({
    id: workspaceId,
    ownerUserId: options.ownerUserId,
    flyMachineId: tenant.machineId,
    flyPrivateIp: tenant.privateIp,
    gbrainBaseUrl: tenant.gbrainBaseUrl,
    gbrainOauthClientId: oauth.client_id,
    gbrainOauthClientSecretCiphertext: encryptedSecret,
    proxyTokenHash: proxyToken.hash,
    gbrainVersion: options.gbrainVersion,
  });

  return {
    workspaceId: workspace.id,
    flyMachineId: tenant.machineId,
    flyPrivateIp: tenant.privateIp,
    gbrainBaseUrl: tenant.gbrainBaseUrl,
  };
}

/**
 * BYOK and the tenant container env: WHY THE PROXY TOKEN IS THE ONLY KEY
 * THE TENANT EVER SEES.
 *
 * The tenant container's OPENAI_API_KEY / ANTHROPIC_API_KEY env vars hold
 * the per-tenant *proxy token* — never a real provider key. The proxy
 * resolves the real key at request time via auth/llm-keys.ts:resolveLlmKey,
 * which prefers the workspace's BYOK credential and falls back to the
 * server's shared env key.
 *
 * Consequences:
 *   1. Setting / rotating / deleting a BYOK key never requires restarting
 *      the tenant container. The proxy picks up the change on the next call.
 *   2. The tenant never has access to the real provider key, even if gbrain
 *      is fully compromised. A leaked tenant container yields the proxy
 *      token, which is rate-limited and audited per workspace.
 *   3. We do NOT inject OPENAI_API_KEY=<real key> when BYOK is set. Don't
 *      add that path back in a future "optimization" — it would defeat the
 *      whole boundary.
 *
 * If you're touching tenant provisioning and find yourself thinking "I'll
 * just inject the real key into the container", stop and read this comment
 * again.
 */
async function createFlyTenant(options: {
  env: TenantProvisionEnv;
  gbrainVersion: string;
  workspaceId: string;
  ownerUserId: string;
  proxyToken: string;
  fetch: Fetch;
}): Promise<{ machineId: string; privateIp: string; gbrainBaseUrl: string }> {
  const token = required(options.env.FLY_API_TOKEN, 'FLY_API_TOKEN');
  const appName = required(options.env.FLY_TENANTS_APP_NAME, 'FLY_TENANTS_APP_NAME');
  const region = options.env.GBRAIN_TENANT_REGION;
  const volume = await createFlyVolume({
    appName,
    fetch: options.fetch,
    workspaceId: options.workspaceId,
    region,
    sizeGb: Number(options.env.GBRAIN_TENANT_VOLUME_SIZE_GB ?? 3),
    token,
  });
  const machine = await createFlyMachine({
    appName,
    token,
    image: tenantImage(options.env, options.gbrainVersion),
    gbrainVersion: options.gbrainVersion,
    workspaceId: options.workspaceId,
    postgresDb: options.env.GBRAIN_POSTGRES_DB ?? 'gbrain',
    postgresPassword: options.env.GBRAIN_POSTGRES_PASSWORD,
    postgresUser: options.env.GBRAIN_POSTGRES_USER ?? 'gbrain',
    open42ApiBaseUrl: flyOpen42ApiBaseUrl(options.env),
    proxyToken: options.proxyToken,
    region,
    fetch: options.fetch,
    volumeId: volume.id,
  });
  return {
    machineId: machine.id,
    privateIp: machine.privateIp,
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

async function createLocalDockerTenant(options: {
  env: TenantProvisionEnv;
  gbrainVersion: string;
  workspaceId: string;
  ownerUserId: string;
  proxyToken: string;
  runCommand: CommandRunner;
  allocatePort: (startAt: number) => Promise<number>;
}): Promise<{ machineId: string; privateIp: string; gbrainBaseUrl: string }> {
  const image = tenantImage(options.env, options.gbrainVersion);
  const gitRef = gbrainGitRef(options.env);
  const containerName = `open42-gbrain-${options.workspaceId.slice(0, 8)}`;
  const port = await options.allocatePort(Number(options.env.GBRAIN_LOCAL_PORT_START ?? 18080));
  const baseUrl = `http://127.0.0.1:${port}`;
  const dataVolume = `${containerName}-data`;
  const postgresUser = options.env.GBRAIN_POSTGRES_USER ?? 'gbrain';
  const postgresDb = options.env.GBRAIN_POSTGRES_DB ?? 'gbrain';
  const open42ApiBaseUrl = localOpen42ApiBaseUrl(options.env);

  await ensureLocalTenantImage(image, options.gbrainVersion, gitRef, options.runCommand);
  await options.runCommand('docker', ['volume', 'create', dataVolume]);
  await removeDockerContainer(containerName, options.runCommand);
  let envFile: string | null = null;
  try {
    envFile = await createDockerEnvFile({
      GBRAIN_PUBLIC_URL: baseUrl,
      GBRAIN_POSTGRES_DB: postgresDb,
      GBRAIN_POSTGRES_USER: postgresUser,
      ...(options.env.GBRAIN_POSTGRES_PASSWORD
        ? { GBRAIN_POSTGRES_PASSWORD: options.env.GBRAIN_POSTGRES_PASSWORD }
        : {}),
      GBRAIN_VERSION: options.gbrainVersion,
      GBRAIN_HOME: '/data/gbrain',
      OPENAI_API_KEY: options.proxyToken,
      OPENAI_BASE_URL: `${open42ApiBaseUrl}/proxy/openai/v1`,
      ANTHROPIC_API_KEY: options.proxyToken,
      ANTHROPIC_BASE_URL: `${open42ApiBaseUrl}/proxy/anthropic`,
    });
    await options.runCommand('docker', [
      'run',
      '-d',
      '--name',
      containerName,
      '-p',
      `127.0.0.1:${port}:8080`,
      '--env-file',
      envFile,
      '-v',
      `${dataVolume}:/data`,
      image,
    ]);
  } finally {
    if (envFile) {
      await rm(dirname(envFile), { recursive: true, force: true }).catch(() => undefined);
    }
  }

  return {
    machineId: containerName,
    privateIp: `127.0.0.1:${port}`,
    gbrainBaseUrl: baseUrl,
  };
}

async function ensureLocalTenantImage(
  image: string,
  gbrainVersion: string,
  gitRef: string,
  runCommand: CommandRunner,
): Promise<void> {
  // 1) Already cached locally? Use it.
  try {
    await runCommand('docker', ['image', 'inspect', image]);
    return;
  } catch {
    // miss — try registry next
  }
  // 2) Try to pull from a registry. Default tag (open42/gbrain-tenant:v${VERSION})
  // lives on Docker Hub; custom tags may live elsewhere — we just call pull.
  try {
    await runCommand('docker', ['pull', image]);
    return;
  } catch {
    // miss — fall through to local build
  }
  // 3) Last resort: build from infra/Dockerfile.gbrain-tenant. Slow (~5 min).
  // This path is the safety net for contributors editing the Dockerfile or
  // running with a tag that hasn't been published yet.
  await runCommand('docker', [
    'build',
    '-f',
    'infra/Dockerfile.gbrain-tenant',
    '--build-arg',
    `GBRAIN_VERSION=${gbrainVersion}`,
    '--build-arg',
    `GBRAIN_GIT_REF=${gitRef}`,
    '-t',
    image,
    '.',
  ]);
}

async function removeDockerContainer(name: string, runCommand: CommandRunner): Promise<void> {
  await runCommand('docker', ['rm', '-f', name]).catch(() => ({
    stdout: '',
    stderr: '',
  }));
}

async function waitForGbrainHealth(
  baseUrl: string,
  fetchImpl: Fetch,
  sleepImpl: (ms: number) => Promise<void>,
): Promise<void> {
  const deadline = Date.now() + 90_000;
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

// Exported for DB-level tests (provision.db.test.ts). Production callers go
// through provisionTenant / safelyProvisionTenant which resolve the default
// repo internally.
export function createDrizzleTenantRepo(): TenantProvisionRepo {
  return {
    async findWorkspaceById(workspaceId) {
      const { db: defaultDb, schema } = await import('../db/client.js');
      const [workspace] = await defaultDb
        .select()
        .from(schema.workspaces)
        .where(
          and(
            eq(schema.workspaces.id, workspaceId),
            eq(schema.workspaces.status, 'ready'),
            sql`${schema.workspaces.deletedAt} IS NULL`,
          ),
        )
        .limit(1);
      if (
        !workspace ||
        !(workspace.gbrainBaseUrl || workspace.flyPrivateIp) ||
        !workspace.flyMachineId
      ) {
        return null;
      }
      return {
        workspaceId: workspace.id,
        flyMachineId: workspace.flyMachineId,
        flyPrivateIp: workspace.flyPrivateIp ?? '',
        gbrainBaseUrl: workspace.gbrainBaseUrl ?? formatGbrainBaseUrl(workspace.flyPrivateIp ?? ''),
      };
    },
    async ensureWorkspaceForProvisioning(workspaceId, ownerUserId, gbrainVersion) {
      const { db: defaultDb, schema } = await import('../db/client.js');
      return defaultDb.transaction(async (tx) => {
        // Primary path: the workspace row was created upfront by the route
        // handler (createWorkspaceForUser / saveWorkspaceName). Validate it
        // exists, belongs to ownerUserId, and is not soft-deleted.
        const [existing] = await tx
          .select({ id: schema.workspaces.id, ownerUserId: schema.workspaces.ownerUserId })
          .from(schema.workspaces)
          .where(
            and(
              eq(schema.workspaces.id, workspaceId),
              sql`${schema.workspaces.deletedAt} IS NULL`,
            ),
          )
          .limit(1);
        if (existing) {
          if (existing.ownerUserId !== ownerUserId) {
            throw new Error('workspace_owner_mismatch');
          }
          return { id: existing.id };
        }

        // Legacy fallback for callers that operate by owner only (dev script):
        // create the row now. Production callers always create upfront, so
        // this branch should never fire in normal operation.
        const [workspace] = await tx
          .insert(schema.workspaces)
          .values({
            id: workspaceId,
            ownerUserId,
            gbrainVersion,
            status: 'provisioning',
          })
          .returning({ id: schema.workspaces.id });
        if (!workspace) throw new Error('workspace_insert_failed');

        await tx
          .update(schema.users)
          .set({ currentWorkspaceId: workspace.id })
          .where(
            and(eq(schema.users.id, ownerUserId), sql`${schema.users.currentWorkspaceId} IS NULL`),
          );
        await tx
          .insert(schema.memberships)
          .values({ userId: ownerUserId, workspaceId: workspace.id, role: 'owner' })
          .onConflictDoNothing();

        return { id: workspace.id };
      });
    },
    async withWorkspaceProvisioningLock(workspaceId, provision) {
      const { db: defaultDb } = await import('../db/client.js');
      return defaultDb.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${workspaceId}))`);
        return provision();
      });
    },
    async createWorkspace(input) {
      const { db: defaultDb, schema } = await import('../db/client.js');
      return defaultDb.transaction(async (tx) => {
        const [user] = await tx
          .select({
            currentWorkspaceId: schema.users.currentWorkspaceId,
          })
          .from(schema.users)
          .where(eq(schema.users.id, input.ownerUserId))
          .limit(1);

        const values = {
          flyMachineId: input.flyMachineId,
          flyPrivateIp: input.flyPrivateIp,
          gbrainBaseUrl: input.gbrainBaseUrl,
          gbrainOauthClientId: input.gbrainOauthClientId,
          gbrainOauthClientSecretCiphertext: input.gbrainOauthClientSecretCiphertext,
          proxyTokenHash: input.proxyTokenHash,
          gbrainVersion: input.gbrainVersion,
          status: 'ready' as const,
        };
        const workspaceId = input.id ?? user?.currentWorkspaceId;

        const [workspace] = workspaceId
          ? await tx
              .update(schema.workspaces)
              .set(values)
              .where(
                and(
                  eq(schema.workspaces.id, workspaceId),
                  eq(schema.workspaces.ownerUserId, input.ownerUserId),
                ),
              )
              .returning({ id: schema.workspaces.id })
          : await tx
              .insert(schema.workspaces)
              .values({
                id: input.id,
                ownerUserId: input.ownerUserId,
                ...values,
              })
              .returning({ id: schema.workspaces.id });

        if (!workspace?.id) {
          throw new Error('workspace insert returned no row');
        }

        // Best-effort: set users.current_workspace_id when the user has none.
        // Codex round-4 P2: guard with IS NULL so a background-provisioned
        // workspace doesn't silently switch the active workspace out from
        // under a user who's currently working in another one. The first
        // workspace will still self-set because current_workspace_id starts
        // null. Mirrors the guard in apps/api/src/workspaces/create.ts.
        await tx
          .update(schema.users)
          .set({ currentWorkspaceId: workspace.id })
          .where(
            and(
              eq(schema.users.id, input.ownerUserId),
              sql`${schema.users.currentWorkspaceId} IS NULL`,
            ),
          );

        await tx
          .insert(schema.memberships)
          .values({
            userId: input.ownerUserId,
            workspaceId: workspace.id,
            role: 'owner',
          })
          .onConflictDoNothing();

        return workspace;
      });
    },
    async markWorkspaceFailedById(workspaceId, errorCode) {
      const { db: defaultDb, schema } = await import('../db/client.js');
      await defaultDb
        .update(schema.workspaces)
        .set({
          status: 'failed',
          lastError: errorCode,
          provisionAttempts: sql`${schema.workspaces.provisionAttempts} + 1`,
        })
        .where(eq(schema.workspaces.id, workspaceId));
    },
    async resetWorkspaceById(workspaceId) {
      const { db: defaultDb, schema } = await import('../db/client.js');
      await defaultDb
        .update(schema.workspaces)
        .set({
          status: 'provisioning',
          lastError: null,
          provisioningStartedAt: new Date(),
        })
        .where(eq(schema.workspaces.id, workspaceId));
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

function localOpen42ApiBaseUrl(
  env: TenantProvisionEnv,
  platform: NodeJS.Platform = process.platform,
): string {
  const port = env.API_PORT ?? '3001';
  if (platform === 'darwin' || platform === 'win32') {
    return `http://host.docker.internal:${port}`;
  }
  if (platform === 'linux') {
    return `http://172.17.0.1:${port}`;
  }
  console.warn(`[provision] undetected platform ${platform}; falling back to host.docker.internal`);
  return `http://host.docker.internal:${port}`;
}

function flyOpen42ApiBaseUrl(env: TenantProvisionEnv): string {
  const host = env.OPEN42_API_FLYCAST_HOST ?? 'open42-api.flycast';
  const withProtocol = /^https?:\/\//.test(host) ? host : `http://${host}`;
  return withProtocol.replace(/\/+$/, '');
}

function selectProvisioner(env: TenantProvisionEnv): 'fly' | 'local-docker' {
  if (env.TENANT_PROVISIONER === 'fly') return 'fly';
  if (env.TENANT_PROVISIONER === 'local-docker') return 'local-docker';
  if (env.TENANT_PROVISIONER) {
    throw new Error('TENANT_PROVISIONER must be "fly" or "local-docker"');
  }
  return 'local-docker';
}

function tenantImage(env: TenantProvisionEnv, gbrainVersion: string): string {
  return env.GBRAIN_TENANT_IMAGE ?? `open42/gbrain-tenant:v${gbrainVersion}`;
}

export const DEFAULT_GBRAIN_GIT_REF = '9c60b3a068849f695034d82eb6c2b99287f9a054';
const SHA_PATTERN = /^[0-9a-f]{40}$/i;

export function gbrainGitRef(
  env: TenantProvisionEnv,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): string {
  // Pinned to the immutable v0.31.3 release commit on garrytan/gbrain master.
  // Branches are mutable (a force-push would silently land in the next image
  // rebuild), so we pin to the SHA. Bump
  // deliberately as part of an Open42 release — see
  // ENGINEERING.md §gbrain version pinning. Mirrors the default in
  // infra/Dockerfile.gbrain-tenant.
  const ref = env.GBRAIN_GIT_REF ?? DEFAULT_GBRAIN_GIT_REF;
  // Production fail-loud: reject anything that isn't a 40-char SHA so a stray
  // branch ref (mutable, force-pushable) can't sneak into a production image
  // rebuild. Dev/test stays permissive — branch refs are useful when iterating
  // on gbrain locally.
  if (nodeEnv === 'production' && !SHA_PATTERN.test(ref)) {
    throw new Error(
      `GBRAIN_GIT_REF must be a 40-char hex SHA in production, got: ${ref}`,
    );
  }
  return ref;
}

async function createDockerEnvFile(env: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'open42-tenant-env-'));
  const path = join(dir, 'tenant.env');
  const body =
    Object.entries(env)
      .map(([key, value]) => `${key}=${dockerEnvValue(key, value)}`)
      .join('\n') + '\n';
  await writeFile(path, body, { mode: 0o600 });
  await chmod(path, 0o600);
  return path;
}

function dockerEnvValue(key: string, value: string): string {
  if (!/^[A-Z0-9_]+$/.test(key)) {
    throw new Error(`invalid Docker env key: ${key}`);
  }
  if (value.includes('\n') || value.includes('\r') || value.includes('\0')) {
    throw new Error(`invalid Docker env value for ${key}`);
  }
  return value;
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

async function runCommand(
  file: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
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
