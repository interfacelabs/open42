import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEK_BYTES = 32;

export class EnvelopeEncryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvelopeEncryptionError';
  }
}

export function readKek(env: { OPEN42_KEK?: string } = process.env): Buffer {
  const raw = env.OPEN42_KEK?.trim();
  if (!raw) {
    throw new EnvelopeEncryptionError('OPEN42_KEK is required');
  }

  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (key.byteLength !== KEK_BYTES) {
    throw new EnvelopeEncryptionError('OPEN42_KEK must decode to 32 bytes');
  }
  return key;
}

export function encryptSecret(plaintext: string, aad?: string): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', readKek(), iv);
  if (aad) {
    cipher.setAAD(Buffer.from(aad, 'utf8'));
  }

  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([VERSION]), iv, tag, ciphertext]);
}

export function decryptSecret(envelope: Buffer | Uint8Array | string, aad?: string): string {
  const packed = typeof envelope === 'string' ? Buffer.from(envelope, 'base64') : Buffer.from(envelope);
  if (packed.byteLength < 1 + IV_BYTES + TAG_BYTES) {
    throw new EnvelopeEncryptionError('ciphertext envelope is too short');
  }
  if (packed[0] !== VERSION) {
    throw new EnvelopeEncryptionError('unsupported ciphertext envelope version');
  }

  const iv = packed.subarray(1, 1 + IV_BYTES);
  const tag = packed.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
  const ciphertext = packed.subarray(1 + IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', readKek(), iv);
  if (aad) {
    decipher.setAAD(Buffer.from(aad, 'utf8'));
  }
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
