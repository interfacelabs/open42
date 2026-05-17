import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as ed25519Sign,
  verify as ed25519Verify,
} from 'node:crypto';
import { eq } from 'drizzle-orm';

import { decryptSecret as defaultDecryptSecret, encryptSecret as defaultEncryptSecret } from '../crypto/envelope.js';
import { db as defaultDb, schema } from '../db/client.js';

export const WORKSPACE_SIGNING_KEY_PURPOSE = 'workspace_signing_key';

export interface WorkspaceSigningMaterial {
  workspaceId: string;
  publicKey: string;
  privateKey: string;
}

export interface SkillSignature {
  payloadSha256Hex: string;
  signature: Buffer;
  signatureBase64: string;
}

export interface GetOrCreateSigningKeyDeps {
  db?: typeof defaultDb;
  encrypt?: typeof defaultEncryptSecret;
  decrypt?: typeof defaultDecryptSecret;
}

export function generateWorkspaceSigningMaterial(workspaceId: string): WorkspaceSigningMaterial {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { workspaceId, publicKey, privateKey };
}

export async function getOrCreateWorkspaceSigningKey(
  workspaceId: string,
  deps: GetOrCreateSigningKeyDeps = {},
): Promise<WorkspaceSigningMaterial> {
  if (!workspaceId) throw new Error('workspaceId is required');
  const db = deps.db ?? defaultDb;
  const encrypt = deps.encrypt ?? defaultEncryptSecret;
  const decrypt = deps.decrypt ?? defaultDecryptSecret;

  const existing = await loadWorkspaceSigningKey(workspaceId, { db, decrypt });
  if (existing) return existing;

  const generated = generateWorkspaceSigningMaterial(workspaceId);
  const privateKeyCiphertext = encrypt(generated.privateKey, {
    workspaceId,
    purpose: WORKSPACE_SIGNING_KEY_PURPOSE,
  });

  try {
    await db.insert(schema.workspaceSigningKeys).values({
      workspaceId,
      publicKey: generated.publicKey,
      privateKeyCiphertext,
    });
    return generated;
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const raced = await loadWorkspaceSigningKey(workspaceId, { db, decrypt });
    if (!raced) throw err;
    return raced;
  }
}

export function canonicalizeSkillMarkdown(markdown: string): string {
  return markdown.replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').replace(/\n*$/, '\n');
}

export function signCanonicalSkillMarkdown(markdown: string, privateKeyPem: string): SkillSignature {
  const canonical = canonicalizeSkillMarkdown(markdown);
  const digest = sha256(canonical);
  const privateKey = createPrivateKey(privateKeyPem);
  const signature = ed25519Sign(null, digest, privateKey);
  return {
    payloadSha256Hex: digest.toString('hex'),
    signature,
    signatureBase64: signature.toString('base64'),
  };
}

export function verifyCanonicalSkillMarkdownSignature(input: {
  markdown: string;
  signature: Buffer | string;
  publicKeyPem: string;
}): boolean {
  const canonical = canonicalizeSkillMarkdown(input.markdown);
  const digest = sha256(canonical);
  const signature =
    typeof input.signature === 'string' ? Buffer.from(input.signature, 'base64') : input.signature;
  return ed25519Verify(null, digest, createPublicKey(input.publicKeyPem), signature);
}

function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

async function loadWorkspaceSigningKey(
  workspaceId: string,
  deps: {
    db: typeof defaultDb;
    decrypt: typeof defaultDecryptSecret;
  },
): Promise<WorkspaceSigningMaterial | null> {
  const [row] = await deps.db
    .select()
    .from(schema.workspaceSigningKeys)
    .where(eq(schema.workspaceSigningKeys.workspaceId, workspaceId))
    .limit(1);
  if (!row) return null;
  return {
    workspaceId,
    publicKey: row.publicKey,
    privateKey: deps.decrypt(row.privateKeyCiphertext, {
      workspaceId,
      purpose: WORKSPACE_SIGNING_KEY_PURPOSE,
    }),
  };
}

function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  if ((err as { code?: unknown }).code === '23505') return true;
  const cause = (err as { cause?: unknown }).cause;
  return !!cause && typeof cause === 'object' && (cause as { code?: unknown }).code === '23505';
}
