import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

const VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEK_BYTES = 32;
const DEK_BYTES = 32;
const HKDF_INFO = Buffer.from('open42:envelope', 'utf8');

export class EnvelopeEncryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvelopeEncryptionError';
  }
}

/**
 * Per-row encryption context. Bound into AES-GCM AAD on encrypt and verified
 * on decrypt — copying a ciphertext from row A into row B fails authentication.
 *
 * `workspaceId` also salts the HKDF derivation, so each tenant gets a distinct
 * DEK from the single master KEK. KEK leak is still catastrophic, but a single
 * tenant DEK leak doesn't expose siblings.
 */
export interface SecretContext {
  workspaceId: string;
  purpose: 'gbrain_oauth_secret' | 'proxy_token' | 'workspace_credential' | string;
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

function deriveDek(kek: Buffer, workspaceId: string): Buffer {
  if (!workspaceId) {
    throw new EnvelopeEncryptionError('SecretContext.workspaceId is required');
  }
  const salt = Buffer.from(workspaceId, 'utf8');
  const derived = hkdfSync('sha256', kek, salt, HKDF_INFO, DEK_BYTES);
  return Buffer.from(derived);
}

function aadFor(ctx: SecretContext): Buffer {
  if (!ctx || typeof ctx.workspaceId !== 'string' || typeof ctx.purpose !== 'string') {
    throw new EnvelopeEncryptionError('SecretContext { workspaceId, purpose } is required');
  }
  if (!ctx.workspaceId || !ctx.purpose) {
    throw new EnvelopeEncryptionError('SecretContext { workspaceId, purpose } must be non-empty');
  }
  return Buffer.from(`${ctx.workspaceId}|${ctx.purpose}`, 'utf8');
}

export function encryptSecret(plaintext: string, ctx: SecretContext): Buffer {
  const kek = readKek();
  const dek = deriveDek(kek, ctx.workspaceId);
  const aad = aadFor(ctx);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', dek, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(aad);

  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([VERSION]), iv, tag, ciphertext]);
}

export function decryptSecret(envelope: Buffer | Uint8Array | string, ctx: SecretContext): string {
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

  const kek = readKek();
  const dek = deriveDek(kek, ctx.workspaceId);
  const aad = aadFor(ctx);
  const decipher = createDecipheriv('aes-256-gcm', dek, iv, { authTagLength: TAG_BYTES });
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);

  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch (err) {
    throw new EnvelopeEncryptionError(
      `envelope authentication failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
