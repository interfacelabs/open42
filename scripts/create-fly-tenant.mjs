import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config } from 'dotenv';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
for (const file of ['.env.local', '.env']) {
  const path = resolve(repoRoot, file);
  if (existsSync(path)) config({ path, override: false });
}

const args = parseArgs(process.argv.slice(2));
const apiBase = process.env.FLY_API_HOSTNAME ?? 'https://api.machines.dev';
const token = required(process.env.FLY_API_TOKEN, 'FLY_API_TOKEN');
const appName = required(args.app ?? process.env.FLY_TENANTS_APP_NAME, 'FLY_TENANTS_APP_NAME');
const gbrainVersion = process.env.GBRAIN_VERSION ?? '0.27.1';
const image = args.image ?? process.env.GBRAIN_TENANT_IMAGE ?? `open42/gbrain-tenant:v${gbrainVersion}`;
const ownerUserId = args.ownerUserId ?? `fly-smoke-${randomUUID().slice(0, 8)}`;
const tenantSlug = tenantSlugFromOwner(ownerUserId);
const machineName = args.name ?? `open42-${tenantSlug}-${Date.now().toString(36).slice(-5)}`;
const region = args.region ?? process.env.FLY_REGION;
const volumeSizeGb = Number(args.volumeSize ?? process.env.GBRAIN_TENANT_VOLUME_SIZE_GB ?? 3);

await ensureApp({ appName, create: args.createApp, orgSlug: args.org ?? process.env.FLY_ORG_SLUG });
if (args.createAppOnly) {
  console.log(JSON.stringify({ app: appName, state: 'app-ready' }, null, 2));
  process.exit(0);
}

const volume = await createVolume({
  appName,
  name: volumeNameFromOwner(ownerUserId),
  region,
  sizeGb: volumeSizeGb,
});
const machine = await createMachine({
  appName,
  gbrainVersion,
  image,
  machineName,
  ownerUserId,
  postgresDb: process.env.GBRAIN_POSTGRES_DB ?? 'gbrain',
  postgresPassword: process.env.GBRAIN_POSTGRES_PASSWORD,
  postgresUser: process.env.GBRAIN_POSTGRES_USER ?? 'gbrain',
  region,
  volumeId: volume.id,
});

if (!args.skipWait) {
  await waitForMachine(appName, machine.id, normalizeWaitTimeout(args.timeout));
}

console.log(
  JSON.stringify(
    {
      app: appName,
      machineId: machine.id,
      machineName,
      privateIp: machine.private_ip ?? machine.privateIp,
      image,
      gbrainVersion,
      volumeId: volume.id,
      volumeSizeGb,
      state: args.skipWait ? machine.state : 'started',
      note:
        'gbrain is private on Fly 6PN; health/DCR must be checked from Open42 on Fly, WireGuard, or another machine in the org.',
    },
    null,
    2,
  ),
);

async function ensureApp(options) {
  const response = await flyFetch(`/v1/apps/${encodeURIComponent(options.appName)}`, {
    expected: [200, 404],
  });
  if (response.status === 200) return;
  if (!options.create) {
    throw new Error(
      `Fly app ${options.appName} was not found. Create it first, or rerun with --create-app --org <org_slug>.`,
    );
  }
  const orgSlug = required(options.orgSlug, 'FLY_ORG_SLUG or --org');
  await flyFetch('/v1/apps', {
    method: 'POST',
    expected: [200, 201],
    body: {
      app_name: options.appName,
      org_slug: orgSlug,
    },
  });
}

async function createVolume(options) {
  const response = await flyFetch(`/v1/apps/${encodeURIComponent(options.appName)}/volumes`, {
    method: 'POST',
    expected: [200, 201],
    body: {
      name: options.name,
      region: options.region,
      size_gb: options.sizeGb,
    },
  });
  return response.payload;
}

async function createMachine(options) {
  const body = {
    name: options.machineName,
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
      metadata: {
        open42_owner_user_id: options.ownerUserId,
        open42_tenant: 'true',
      },
      services: [],
    },
  };
  const response = await flyFetch(`/v1/apps/${encodeURIComponent(options.appName)}/machines`, {
    method: 'POST',
    expected: [200, 201],
    body,
  });
  return response.payload;
}

async function waitForMachine(appName, machineId, timeout) {
  await flyFetch(
    `/v1/apps/${encodeURIComponent(appName)}/machines/${encodeURIComponent(
      machineId,
    )}/wait?state=started&timeout=${encodeURIComponent(String(timeout))}`,
    {
      expected: [200],
    },
  );
}

async function flyFetch(path, options = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : undefined;
  } catch {
    payload = text;
  }
  const expected = options.expected ?? [200];
  if (!expected.includes(response.status)) {
    throw new Error(
      `Fly API ${options.method ?? 'GET'} ${path} failed with ${response.status}: ${summarizePayload(
        payload,
      )}`,
    );
  }
  return { status: response.status, payload };
}

function summarizePayload(payload) {
  if (typeof payload === 'string') return payload.slice(0, 300);
  if (!payload) return '';
  const clone = JSON.parse(JSON.stringify(payload));
  for (const key of ['token', 'access_token', 'client_secret', 'password']) {
    if (clone[key]) clone[key] = '***';
  }
  return JSON.stringify(clone).slice(0, 500);
}

function tenantSlugFromOwner(ownerUserId) {
  return ownerUserId
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 12);
}

function volumeNameFromOwner(ownerUserId) {
  const suffix =
    ownerUserId
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 16) || 'tenant';
  return `open42_gbrain_${suffix}`.slice(0, 30);
}

function normalizeWaitTimeout(value) {
  const timeout = Number(value ?? 60);
  if (!Number.isFinite(timeout)) return 60;
  return Math.min(Math.max(Math.trunc(timeout), 1), 60);
}

function required(value, name) {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--create-app') parsed.createApp = true;
    else if (arg === '--create-app-only') {
      parsed.createApp = true;
      parsed.createAppOnly = true;
    }
    else if (arg === '--skip-wait') parsed.skipWait = true;
    else if (arg === '--app') parsed.app = argv[++i];
    else if (arg === '--image') parsed.image = argv[++i];
    else if (arg === '--name') parsed.name = argv[++i];
    else if (arg === '--org') parsed.org = argv[++i];
    else if (arg === '--owner-user-id') parsed.ownerUserId = argv[++i];
    else if (arg === '--region') parsed.region = argv[++i];
    else if (arg === '--timeout') parsed.timeout = Number(argv[++i]);
    else if (arg === '--volume-size') parsed.volumeSize = Number(argv[++i]);
    else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return parsed;
}
