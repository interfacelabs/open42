#!/usr/bin/env node
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const args = process.argv.slice(2);
const printOnly = args.includes('--print');
const askProviderKeys = args.includes('--ask-provider-keys');
const envFileArg = argValue('--env-path') ?? argValue('--env-file') ?? '.env';
const envPath = resolve(process.cwd(), envFileArg);

const existing = printOnly ? new Map() : parseEnvFile(envPath);
const workspaceId = valueOrGenerated(existing, 'OPEN42_SINGLE_WORKSPACE_ID', () => randomUUID());
const generated = {
  OPEN42_EDITION: process.env.OPEN42_EDITION ?? 'community',
  OPEN42_ALLOW_MULTI_WORKSPACE: 'false',
  OPEN42_ALLOW_SHARED_KEYS: 'false',
  OPEN42_KEK: valueOrGenerated(existing, 'OPEN42_KEK', randomHex32),
  SESSION_SECRET: valueOrGenerated(existing, 'SESSION_SECRET', randomHex32),
  OPEN42_SINGLE_WORKSPACE_ID: workspaceId,
  OPEN42_TENANT_PROXY_TOKEN: tenantProxyTokenForWorkspace(existing, workspaceId),
};

if (printOnly) {
  for (const [key, value] of Object.entries(generated)) {
    console.log(`${key}=${value}`);
  }
  console.error('Bootstrap owner: the first Supabase magic-link recipient becomes the owner.');
  process.exit(0);
}

const rl = createInterface({ input, output });
try {
  const prompted = {
    SUPABASE_URL: await askIfMissing(rl, existing, 'SUPABASE_URL', 'Supabase URL'),
    SUPABASE_ANON_KEY: await askIfMissing(rl, existing, 'SUPABASE_ANON_KEY', 'Supabase anon key'),
    SUPABASE_SERVICE_ROLE_KEY: await askIfMissing(
      rl,
      existing,
      'SUPABASE_SERVICE_ROLE_KEY',
      'Supabase service role key',
    ),
  };

  const providerKeys = {};
  const forceUpsert = new Set();
  if (askProviderKeys) {
    console.log('');
    console.log('Optional provider keys (leave blank to add later in Settings):');
    const anthropic = await askOptional(rl, existing, 'ANTHROPIC_API_KEY', 'Anthropic API key');
    const openai = await askOptional(rl, existing, 'OPENAI_API_KEY', 'OpenAI API key');
    if (anthropic) providerKeys.ANTHROPIC_API_KEY = anthropic;
    if (openai) providerKeys.OPENAI_API_KEY = openai;
    if (anthropic || openai) {
      generated.OPEN42_ALLOW_SHARED_KEYS = 'true';
      forceUpsert.add('OPEN42_ALLOW_SHARED_KEYS');
      console.log('');
      console.log('Enabled shared-keys mode (OPEN42_ALLOW_SHARED_KEYS=true).');
      console.log(
        'Workspace members will use these server keys until they add their own in Settings.',
      );
    }
  }

  const values = {
    ...generated,
    ...prompted,
    ...providerKeys,
    TENANT_PROVISIONER: valueOrGenerated(existing, 'TENANT_PROVISIONER', () => 'compose'),
    GBRAIN_BASE_URL: valueOrGenerated(existing, 'GBRAIN_BASE_URL', () => 'http://gbrain:8080'),
    GBRAIN_VERSION: valueOrGenerated(existing, 'GBRAIN_VERSION', () => '0.31.3'),
    GBRAIN_TENANT_IMAGE: valueOrGenerated(
      existing,
      'GBRAIN_TENANT_IMAGE',
      () => 'open42/gbrain-tenant:v0.31.3',
    ),
  };

  await upsertEnvFile(envPath, values, forceUpsert);
  console.log(`Wrote ${envPath}`);
  console.log('Bootstrap owner: the first Supabase magic-link recipient becomes the owner.');
} finally {
  rl.close();
}

function argValue(name) {
  const prefixed = args.find((arg) => arg.startsWith(`${name}=`));
  if (prefixed) {
    const value = prefixed.slice(name.length + 1);
    if (!value) throw new Error(`${name} requires a value`);
    return value;
  }
  const index = args.indexOf(name);
  if (index === -1) return null;
  const value = args[index + 1] ?? null;
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return value;
}

function randomHex32() {
  return randomBytes(32).toString('hex');
}

function parseEnvFile(path) {
  const values = new Map();
  if (!existsSync(path)) return values;
  const body = readFileSync(path, 'utf8');
  for (const line of body.split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (match?.[1]) values.set(match[1], match[2] ?? '');
  }
  return values;
}

function valueOrGenerated(existing, key, generate) {
  const current = existing.get(key);
  return isUsable(current) ? current : generate();
}

function tenantProxyTokenForWorkspace(existing, workspaceId) {
  const current = existing.get('OPEN42_TENANT_PROXY_TOKEN');
  if (isUsable(current) && current.startsWith(`tnt_${workspaceId}_`)) return current;
  return `tnt_${workspaceId}_${randomBytes(16).toString('hex')}`;
}

async function askIfMissing(rl, existing, key, label) {
  const current = existing.get(key);
  if (isUsable(current)) return current;
  while (true) {
    const answer = await ask(rl, `${label}: `);
    if (answer === null) {
      throw new Error(
        `${label} is required. Re-run interactively or pre-populate ${key} in the env file.`,
      );
    }
    const trimmed = answer.trim();
    if (isUsable(trimmed)) return trimmed;
    if (!input.isTTY) {
      throw new Error(
        `${label} is required. Re-run interactively or pre-populate ${key} in the env file.`,
      );
    }
    console.log(`${label} is required.`);
  }
}

async function askOptional(rl, existing, key, label) {
  const current = existing.get(key);
  if (isUsable(current)) return current;
  const answer = await ask(rl, `${label} (optional, press Enter to skip): `);
  if (answer === null) return '';
  const trimmed = answer.trim();
  return trimmed.length > 0 ? trimmed : '';
}

async function ask(rl, prompt) {
  if (rl.closed) return null;
  const aborter = new AbortController();
  const onClose = () => aborter.abort();
  rl.once('close', onClose);
  try {
    return await rl.question(prompt, { signal: aborter.signal });
  } catch (error) {
    if (
      error?.name === 'AbortError' ||
      error?.code === 'ERR_INVALID_STATE' ||
      error?.code === 'ERR_USE_AFTER_CLOSE'
    ) {
      return null;
    }
    throw error;
  } finally {
    rl.off('close', onClose);
  }
}

function isUsable(value) {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return ![
    'replace-me',
    'changeme',
    'change-me',
    'replace-with-32-byte-hex-key',
    'your-anon-key',
    'your-service-role-key',
    'https://your-project.supabase.co',
  ].includes(normalized);
}

async function upsertEnvFile(path, values, forceUpsert = new Set()) {
  const forceList = forceUpsert instanceof Set ? forceUpsert : new Set(forceUpsert);
  forceList.add('OPEN42_TENANT_PROXY_TOKEN');
  const lines = existsSync(path) ? (await readFile(path, 'utf8')).split(/\r?\n/) : [];
  const seen = new Set();
  const next = lines.map((line) => {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (!match?.[1] || !(match[1] in values)) return line;
    seen.add(match[1]);
    const current = match[2] ?? '';
    if (forceList.has(match[1]) && current !== values[match[1]]) {
      return `${match[1]}=${values[match[1]]}`;
    }
    return isUsable(current) ? line : `${match[1]}=${values[match[1]]}`;
  });
  for (const [key, value] of Object.entries(values)) {
    if (!seen.has(key)) next.push(`${key}=${value}`);
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, next.join('\n').replace(/\n*$/, '\n'));
}
