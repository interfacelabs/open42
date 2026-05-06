import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config } from 'dotenv';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

for (const file of ['.env.local', '.env']) {
  const path = resolve(repoRoot, file);
  if (existsSync(path)) {
    config({ path, override: false });
  }
}

const publicUrl = process.env.LANDING_PUBLIC_URL ?? 'http://localhost:3002';
const landingPort = process.env.LANDING_PORT ?? portFromUrl(publicUrl) ?? '3002';
const nextCli = resolve(repoRoot, 'node_modules/next/dist/bin/next');
const child = spawn(process.execPath, [nextCli, 'dev', '-p', landingPort], {
  cwd: resolve(repoRoot, 'apps/landing'),
  stdio: 'inherit',
  env: process.env,
  shell: process.platform === 'win32',
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

function portFromUrl(value) {
  try {
    const url = new URL(value);
    if (url.port) return url.port;
    return url.protocol === 'https:' ? '443' : '80';
  } catch {
    return null;
  }
}
