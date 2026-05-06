import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config } from 'dotenv';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

for (const file of ['.env.local', '.env']) {
  const path = resolve(repoRoot, file);
  if (existsSync(path)) config({ path, override: false });
}

const version = process.env.GBRAIN_VERSION ?? '0.27.1';
const ref = process.env.GBRAIN_GIT_REF ?? 'garrytan/v0.27.1-multimodal';
const image = process.env.GBRAIN_TENANT_IMAGE ?? `open42/gbrain-tenant:v${version}`;
const platform = process.env.GBRAIN_TENANT_PLATFORM ?? 'linux/amd64';
const child = spawn(
  'docker',
  [
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
  ],
  {
    cwd: repoRoot,
    stdio: 'inherit',
  },
);

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
