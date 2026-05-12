#!/usr/bin/env node
import { access, cp, mkdir, readdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const communityDir = join(repoRoot, 'apps/api/src/db/migrations');
const cloudDir = join(repoRoot, 'packages/cloud/migrations');
const outDir = join(repoRoot, 'packages/cloud/migrations-bundled');

const sources = [
  { label: 'community', dir: communityDir },
  { label: 'cloud', dir: cloudDir },
];

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

const migrations = [];
const seen = new Map();
for (const source of sources) {
  const entries = await readdir(source.dir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const migrationPath = join(source.dir, entry.name, 'migration.sql');
    try {
      await access(migrationPath);
    } catch {
      continue;
    }
    const previous = seen.get(entry.name);
    if (previous) {
      throw new Error(
        `Migration ${entry.name} exists in both ${previous} and ${source.label} migrations`,
      );
    }
    seen.set(entry.name, source.label);
    migrations.push({
      name: entry.name,
      label: source.label,
      from: join(source.dir, entry.name),
      to: join(outDir, entry.name),
    });
  }
}

for (const migration of migrations.sort((a, b) => a.name.localeCompare(b.name))) {
  await cp(migration.from, migration.to, { recursive: true });
}

console.log(`Prepared ${migrations.length} cloud migrations in ${outDir}`);
