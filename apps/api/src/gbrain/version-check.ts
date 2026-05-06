import type { GbrainClient } from './client.js';

export class GbrainVersionMismatchError extends Error {
  constructor(expected: string, actual: string | undefined) {
    super(`gbrain version mismatch: expected ${expected}, got ${actual ?? 'unknown'}`);
    this.name = 'GbrainVersionMismatchError';
  }
}

export async function assertGbrainVersion(
  client: Pick<GbrainClient, 'getHealth'>,
  expected = process.env.GBRAIN_VERSION,
): Promise<void> {
  if (!expected) {
    throw new GbrainVersionMismatchError('GBRAIN_VERSION env', undefined);
  }
  const health = await client.getHealth();
  if (health.version !== expected) {
    throw new GbrainVersionMismatchError(expected, health.version);
  }
}
