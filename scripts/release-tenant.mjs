/**
 * Build the gbrain tenant image and publish it.
 *
 * Pushes to Docker Hub by default (open42/gbrain-tenant:v${GBRAIN_VERSION}) so
 * `docker pull` works for any fresh signup or self-hosted install. Optionally
 * mirrors to registry.fly.io/${FLY_TENANTS_APP_NAME} for the Fly tenant runtime.
 *
 * Prereqs (you handle these once):
 *   - `docker login` (Docker Hub)
 *   - `fly auth docker` (only if you want the Fly mirror)
 *
 * Usage:
 *   node scripts/release-tenant.mjs               # build + push to Docker Hub + Fly (if available)
 *   node scripts/release-tenant.mjs --no-fly      # skip the Fly mirror
 *   node scripts/release-tenant.mjs --no-build    # skip rebuild, push existing local tag
 *
 * Honors env vars: GBRAIN_VERSION, GBRAIN_GIT_REF, GBRAIN_TENANT_IMAGE,
 * GBRAIN_TENANT_PLATFORM, FLY_TENANTS_APP_NAME.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config } from 'dotenv';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
for (const file of ['.env.local', '.env']) {
  const path = resolve(repoRoot, file);
  if (existsSync(path)) config({ path, override: false });
}

const args = new Set(process.argv.slice(2));
const skipBuild = args.has('--no-build');
const skipFly = args.has('--no-fly');

const version = process.env.GBRAIN_VERSION ?? '0.31.3';
// Immutable SHA pin — mirrors infra/Dockerfile.gbrain-tenant.
// See ENGINEERING.md §gbrain version pinning before changing.
const ref = process.env.GBRAIN_GIT_REF ?? '9c60b3a068849f695034d82eb6c2b99287f9a054';
const image = process.env.GBRAIN_TENANT_IMAGE ?? `open42/gbrain-tenant:v${version}`;
const platform = process.env.GBRAIN_TENANT_PLATFORM ?? 'linux/amd64';
const flyApp = process.env.FLY_TENANTS_APP_NAME ?? 'open42-tenants';
const flyImage = `registry.fly.io/${flyApp}:gbrain-tenant-v${version}`;

console.log(`▸ image: ${image}`);
if (!skipFly) console.log(`▸ fly mirror: ${flyImage}`);

if (!skipBuild) {
  run('docker', [
    'build',
    ...(platform ? ['--platform', platform] : []),
    '-f',
    'infra/Dockerfile.gbrain-tenant',
    '--build-arg',
    `GBRAIN_VERSION=${version}`,
    '--build-arg',
    `GBRAIN_GIT_REF=${ref}`,
    '-t',
    image,
    '.',
  ]);
}

run('docker', ['push', image]);

if (!skipFly) {
  run('docker', ['tag', image, flyImage]);
  // Best-effort — if `fly auth docker` hasn't been run, this fails clearly.
  const result = spawnSync('docker', ['push', flyImage], {
    cwd: repoRoot,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    console.warn(
      `\n⚠ docker push to Fly failed. Run "fly auth docker" first, then re-run with --no-build.`,
    );
    process.exit(result.status ?? 1);
  }
}

console.log('\n✓ release complete');

function run(cmd, args) {
  console.log(`\n▸ ${cmd} ${args.join(' ')}`);
  const result = spawnSync(cmd, args, { cwd: repoRoot, stdio: 'inherit' });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
