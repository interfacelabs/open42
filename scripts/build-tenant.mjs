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
const image = process.env.GBRAIN_TENANT_IMAGE ?? `open42/gbrain-tenant:v${version}`;
const child = spawn(
  'docker',
  ['build', '-f', 'infra/Dockerfile.gbrain-tenant', '--build-arg', `GBRAIN_VERSION=${version}`, '-t', image, '.'],
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
