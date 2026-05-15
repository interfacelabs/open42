#!/usr/bin/env node
/**
 * Open42 free-tenant agent.
 *
 * Runs on the free-tenant Hetzner VPS and exposes a tiny private HTTP API used
 * by the core Open42 API. It starts one gbrain tenant container per workspace,
 * with one Docker volume per tenant. Bind this service and tenant ports to the
 * Hetzner private-network address, then restrict inbound traffic to the core
 * API host with Hetzner firewall rules.
 */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const env = process.env;
const token = required(env.TENANT_AGENT_TOKEN, 'TENANT_AGENT_TOKEN');
const host = env.TENANT_AGENT_HOST ?? '127.0.0.1';
const port = numberEnv(env.TENANT_AGENT_PORT, 4317);
const statePath = env.TENANT_AGENT_STATE ?? '/var/lib/open42-tenant-agent/state.json';
const tenantBindAddr = env.TENANT_AGENT_TENANT_BIND_ADDR ?? '127.0.0.1';
const tenantHost = env.TENANT_AGENT_TENANT_HOST ?? tenantBindAddr;
const portStart = numberEnv(env.TENANT_AGENT_PORT_START, 18080);
const portEnd = numberEnv(env.TENANT_AGENT_PORT_END, 22080);
const namePrefix = env.TENANT_AGENT_CONTAINER_PREFIX ?? 'open42-gbrain';
const tenantLocks = new Map();

const server = createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/healthz') {
      json(res, 200, { ok: true });
      return;
    }

    if (req.method === 'POST' && req.url === '/tenants') {
      assertBearer(req.headers.authorization);
      const body = await readJson(req);
      const runtime = await provisionTenantLocked(body);
      json(res, 200, runtime);
      return;
    }

    json(res, 404, { error: 'not_found' });
  } catch (err) {
    const status = typeof err?.status === 'number' ? err.status : 500;
    json(res, status, { error: err?.code ?? 'tenant_agent_error', message: err?.message });
  }
});

server.listen(port, host, () => {
  console.log(`open42 tenant-agent listening on ${host}:${port}`);
});

async function provisionTenantLocked(input) {
  const workspaceId = requiredString(input.workspaceId, 'workspaceId');
  const previous = tenantLocks.get(workspaceId) ?? Promise.resolve();
  const current = previous
    .catch(() => undefined)
    .then(() => provisionTenant({ ...input, workspaceId }));
  const cleanup = current.finally(() => {
    if (tenantLocks.get(workspaceId) === cleanup) tenantLocks.delete(workspaceId);
  });
  tenantLocks.set(workspaceId, cleanup);
  return cleanup;
}

async function provisionTenant(input) {
  const workspaceId = requiredString(input.workspaceId, 'workspaceId');
  const ownerUserId = requiredString(input.ownerUserId, 'ownerUserId');
  const image = requiredString(input.image, 'image');
  const gbrainVersion = requiredString(input.gbrainVersion, 'gbrainVersion');
  const proxyToken = requiredString(input.proxyToken, 'proxyToken');
  const open42ApiBaseUrl = requiredString(input.open42ApiBaseUrl, 'open42ApiBaseUrl').replace(
    /\/+$/,
    '',
  );
  const postgres = typeof input.postgres === 'object' && input.postgres ? input.postgres : {};
  const postgresDb = stringOr(postgres.db, env.GBRAIN_POSTGRES_DB ?? 'gbrain');
  const postgresUser = stringOr(postgres.user, env.GBRAIN_POSTGRES_USER ?? 'gbrain');
  const postgresPassword = stringOr(postgres.password, env.GBRAIN_POSTGRES_PASSWORD ?? '');

  const state = await loadState();
  const existing = state.tenants[workspaceId];
  if (existing && (await ensureContainerRunning(existing.tenantRuntimeId))) {
    return existing;
  }

  const containerName = tenantContainerName(workspaceId);
  const dataVolume = `${containerName}-data`;
  const tenantPort = existing?.port ?? allocatePort(state);
  const gbrainBaseUrl = `http://${hostForUrl(tenantHost)}:${tenantPort}`;

  const imagePresent = await run('docker', ['image', 'inspect', image], { allowFailure: true });
  if (imagePresent.status !== 0) {
    await run('docker', ['pull', image]);
  }
  await run('docker', ['volume', 'create', dataVolume]);
  await run('docker', ['rm', '-f', containerName], { allowFailure: true });

  const envFile = await writeTenantEnv({
    GBRAIN_HOME: '/data/gbrain',
    GBRAIN_PUBLIC_URL: gbrainBaseUrl,
    GBRAIN_POSTGRES_DB: postgresDb,
    GBRAIN_POSTGRES_USER: postgresUser,
    ...(postgresPassword ? { GBRAIN_POSTGRES_PASSWORD: postgresPassword } : {}),
    GBRAIN_VERSION: gbrainVersion,
    OPENAI_API_KEY: proxyToken,
    OPENAI_BASE_URL: `${open42ApiBaseUrl}/proxy/openai/v1`,
    ANTHROPIC_API_KEY: proxyToken,
    ANTHROPIC_BASE_URL: `${open42ApiBaseUrl}/proxy/anthropic`,
  });

  try {
    await run('docker', [
      'run',
      '-d',
      '--restart',
      'unless-stopped',
      '--name',
      containerName,
      '-p',
      `${tenantBindAddr}:${tenantPort}:8080`,
      '--env-file',
      envFile,
      '-v',
      `${dataVolume}:/data`,
      '--label',
      'open42.tenant=true',
      '--label',
      `open42.workspace_id=${workspaceId}`,
      '--label',
      `open42.owner_user_id=${ownerUserId}`,
      image,
    ]);
  } finally {
    await rm(dirname(envFile), { recursive: true, force: true }).catch(() => undefined);
  }

  const runtime = {
    tenantRuntimeId: containerName,
    gbrainPrivateAddress: `${tenantHost}:${tenantPort}`,
    gbrainBaseUrl,
    port: tenantPort,
  };
  state.tenants[workspaceId] = runtime;
  await saveState(state);
  return runtime;
}

async function ensureContainerRunning(containerName) {
  const inspect = await run('docker', ['inspect', '-f', '{{.State.Running}}', containerName], {
    allowFailure: true,
  });
  if (inspect.status !== 0) return false;
  if (inspect.stdout.trim() === 'true') return true;
  const started = await run('docker', ['start', containerName], { allowFailure: true });
  return started.status === 0;
}

async function loadState() {
  try {
    const parsed = JSON.parse(await readFile(statePath, 'utf8'));
    if (parsed && typeof parsed === 'object' && parsed.tenants) return parsed;
  } catch {
    // First boot.
  }
  return { tenants: {} };
}

async function saveState(state) {
  await mkdir(dirname(statePath), { recursive: true });
  const tmp = `${statePath}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await rename(tmp, statePath);
}

function allocatePort(state) {
  const used = new Set(Object.values(state.tenants).map((tenant) => Number(tenant.port)));
  for (let candidate = portStart; candidate <= portEnd; candidate += 1) {
    if (!used.has(candidate)) return candidate;
  }
  throw Object.assign(new Error('no tenant ports available'), {
    status: 503,
    code: 'tenant_ports_exhausted',
  });
}

async function writeTenantEnv(values) {
  const dir = await mkdtemp(join(tmpdir(), 'open42-tenant-agent-'));
  const path = join(dir, 'tenant.env');
  const body = Object.entries(values)
    .map(([key, value]) => `${key}=${envValue(value)}`)
    .join('\n');
  await writeFile(path, `${body}\n`, { mode: 0o600 });
  return path;
}

function run(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (status) => {
      const result = { status: status ?? 1, stdout, stderr };
      if (result.status !== 0 && !options.allowFailure) {
        reject(
          Object.assign(new Error(`${file} ${args[0] ?? ''} failed: ${stderr || stdout}`), {
            status: 500,
            code: 'docker_command_failed',
          }),
        );
        return;
      }
      resolve(result);
    });
  });
}

function assertBearer(header) {
  if (header !== `Bearer ${token}`) {
    throw Object.assign(new Error('unauthorized'), { status: 401, code: 'unauthorized' });
  }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(Object.assign(new Error('body_too_large'), { status: 413, code: 'body_too_large' }));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch {
        reject(Object.assign(new Error('invalid_json'), { status: 400, code: 'invalid_json' }));
      }
    });
    req.on('error', reject);
  });
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(`${JSON.stringify(body)}\n`);
}

function required(value, name) {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function requiredString(value, name) {
  if (typeof value !== 'string' || !value.trim()) {
    throw Object.assign(new Error(`${name} is required`), {
      status: 400,
      code: 'invalid_request',
    });
  }
  return value.trim();
}

function stringOr(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function numberEnv(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}

function hostForUrl(value) {
  return value.includes(':') && !value.startsWith('[') ? `[${value}]` : value;
}

function tenantContainerName(workspaceId) {
  const suffix =
    workspaceId
      .toLowerCase()
      .replace(/[^a-z0-9_.-]+/g, '-')
      .replace(/^[_.-]+|[_.-]+$/g, '')
      .slice(0, 36) || 'tenant';
  return `${namePrefix}-${suffix}`;
}

function envValue(value) {
  return String(value).replace(/[\r\n]/g, '');
}
