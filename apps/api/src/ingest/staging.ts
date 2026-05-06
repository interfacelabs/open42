import { copyFile, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function createCycleStagingDir(jobId: string): Promise<string> {
  const dir = join(tmpdir(), `open42-cycle-${jobId}`);
  await mkdir(dir, { recursive: true });
  await mkdir(join(dir, 'final'), { recursive: true });
  return dir;
}

export function connectionStagingDir(cycleDir: string, connectionId: string): string {
  return join(cycleDir, connectionId);
}

export function finalStagingDir(cycleDir: string): string {
  return join(cycleDir, 'final');
}

export async function removeConnectionStagingDir(
  cycleDir: string,
  connectionId: string,
): Promise<void> {
  await rm(connectionStagingDir(cycleDir, connectionId), { recursive: true, force: true });
}

export async function mergeIntoFinal(
  cycleDir: string,
  successfulConnectionIds: string[],
): Promise<void> {
  const final = finalStagingDir(cycleDir);
  for (const id of successfulConnectionIds) {
    const src = connectionStagingDir(cycleDir, id);
    let entries: string[] = [];
    try {
      entries = await readdir(src);
    } catch {
      continue;
    }
    for (const entry of entries) {
      await copyFile(join(src, entry), join(final, entry));
    }
  }
}

export async function cleanupCycle(cycleDir: string): Promise<void> {
  await rm(cycleDir, { recursive: true, force: true });
}

export async function sweepStaleCycles(maxAgeMs = 60 * 60 * 1000): Promise<number> {
  const root = tmpdir();
  let entries: string[] = [];
  try {
    entries = await readdir(root);
  } catch {
    return 0;
  }

  let removed = 0;
  for (const entry of entries) {
    if (!entry.startsWith('open42-cycle-')) continue;
    const path = join(root, entry);
    try {
      const s = await stat(path);
      if (Date.now() - s.mtimeMs > maxAgeMs) {
        await rm(path, { recursive: true, force: true });
        removed += 1;
      }
    } catch {
      // Best-effort startup cleanup.
    }
  }
  return removed;
}
