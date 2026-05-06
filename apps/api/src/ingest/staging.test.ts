import { mkdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  cleanupCycle,
  connectionStagingDir,
  createCycleStagingDir,
  finalStagingDir,
  mergeIntoFinal,
  removeConnectionStagingDir,
  sweepStaleCycles,
} from './staging.js';

describe('staging helpers', () => {
  it('createCycleStagingDir creates an empty cycle dir with final/ subdir', async () => {
    const dir = await createCycleStagingDir('job-1');
    expect((await stat(dir)).isDirectory()).toBe(true);
    expect((await stat(join(dir, 'final'))).isDirectory()).toBe(true);
    await cleanupCycle(dir);
  });

  it('mergeIntoFinal copies connection subdir contents into final/', async () => {
    const cycle = await createCycleStagingDir('job-2');
    const conn = connectionStagingDir(cycle, 'conn-a');
    await mkdir(conn, { recursive: true });
    await writeFile(join(conn, 'doc-1.md'), 'hello');
    await mergeIntoFinal(cycle, ['conn-a']);
    const merged = await readFile(join(finalStagingDir(cycle), 'doc-1.md'), 'utf8').catch(
      () => null,
    );
    expect(merged).toBe('hello');
    await cleanupCycle(cycle);
  });

  it('removeConnectionStagingDir is idempotent', async () => {
    const cycle = await createCycleStagingDir('job-3');
    await removeConnectionStagingDir(cycle, 'never-existed');
    await cleanupCycle(cycle);
  });

  it('sweepStaleCycles removes only old open42 cycle dirs', async () => {
    const oldDir = await createCycleStagingDir('old-job');
    const freshDir = await createCycleStagingDir('fresh-job');
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await utimes(oldDir, old, old);
    const removed = await sweepStaleCycles(60 * 60 * 1000);
    expect(removed).toBeGreaterThanOrEqual(1);
    await expect(stat(oldDir)).rejects.toThrow();
    expect((await stat(freshDir)).isDirectory()).toBe(true);
    await rm(freshDir, { recursive: true, force: true });
  });
});
