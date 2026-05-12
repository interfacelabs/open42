import { eq } from 'drizzle-orm';

import { db, schema } from '../db/client.js';
import { GbrainClient } from './client.js';

export async function buildGbrainForWorkspace(workspaceId: string): Promise<GbrainClient> {
  const [workspace] = await db
    .select()
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId))
    .limit(1);
  if (!workspace) throw new Error(`workspace ${workspaceId} not found`);

  const baseUrl =
    workspace.gbrainBaseUrl ??
    (workspace.gbrainPrivateAddress ? formatGbrainBaseUrl(workspace.gbrainPrivateAddress) : null);
  if (
    !baseUrl ||
    !workspace.gbrainOauthClientId ||
    !workspace.gbrainOauthClientSecretCiphertext
  ) {
    throw new Error(`workspace ${workspaceId} not ready`);
  }

  return new GbrainClient({
    workspaceId: workspace.id,
    baseUrl,
    oauthClientId: workspace.gbrainOauthClientId,
    oauthClientSecretCiphertext: workspace.gbrainOauthClientSecretCiphertext,
  });
}

function formatGbrainBaseUrl(privateIp: string): string {
  if (/^https?:\/\//.test(privateIp)) return privateIp.replace(/\/+$/, '');
  const host = privateIp.includes(':') && !privateIp.startsWith('[') ? `[${privateIp}]` : privateIp;
  return `http://${host}:8080`;
}
