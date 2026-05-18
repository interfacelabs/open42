import { eq } from 'drizzle-orm';

import { decryptSecret, encryptSecret } from '../crypto/envelope.js';
import { db as defaultDb, schema } from '../db/client.js';
import {
  API_PUBLIC_URL,
  GITHUB_WEBHOOK_SECRET,
  OPEN42_GITHUB_ENABLED,
  WEB_PUBLIC_URL,
} from '../env.js';
import { GitHubApiError, GitHubAppClient } from './client.js';

type Fetch = typeof fetch;
type Db = typeof defaultDb;

export interface GitHubAppConfigInput {
  workspaceId: string;
  userId: string;
  app: GitHubManifestApp;
  db?: Db;
}

export interface GitHubManifestApp {
  id: number | string;
  slug: string;
  name: string;
  html_url?: string;
  pem: string;
  webhook_secret: string;
}

export interface GitHubAppManifestUrlInput {
  workspaceId: string;
  state: string;
  nameSeed: string;
}

export function buildGitHubAppManifestUrl(input: GitHubAppManifestUrlInput): string {
  const manifest = {
    name: `Open42 ${input.nameSeed}`,
    url: WEB_PUBLIC_URL,
    hook_attributes: {
      url: `${API_PUBLIC_URL}/webhooks/github/${encodeURIComponent(input.workspaceId)}`,
      active: true,
    },
    redirect_url: `${WEB_PUBLIC_URL}/connections/github/app/callback`,
    callback_urls: [`${WEB_PUBLIC_URL}/connections/github/callback`],
    setup_url: `${WEB_PUBLIC_URL}/connections/github/callback`,
    description: 'Open42 reads selected Markdown and MDX docs into your self-hosted brain.',
    public: false,
    default_events: ['push', 'installation'],
    default_permissions: {
      contents: 'read',
      metadata: 'read',
    },
  };
  const url = new URL('https://github.com/settings/apps/new');
  url.searchParams.set('manifest', JSON.stringify(manifest));
  url.searchParams.set('state', input.state);
  return url.toString();
}

export async function convertGitHubAppManifestCode(
  code: string,
  fetchImpl: Fetch = fetch,
): Promise<GitHubManifestApp> {
  const response = await fetchImpl(
    `https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'open42',
      },
    },
  );
  if (!response.ok) {
    throw new GitHubApiError(
      'github manifest conversion failed',
      response.status,
      `github_manifest_${response.status}`,
    );
  }
  return validateManifestApp((await response.json()) as Record<string, unknown>);
}

export async function storeWorkspaceGitHubAppConfig(input: GitHubAppConfigInput): Promise<void> {
  const db = input.db ?? defaultDb;
  const now = new Date();
  const privateKeyCiphertext = encryptSecret(input.app.pem, {
    workspaceId: input.workspaceId,
    purpose: 'github_app_private_key',
  });
  const webhookSecretCiphertext = encryptSecret(input.app.webhook_secret, {
    workspaceId: input.workspaceId,
    purpose: 'github_app_webhook_secret',
  });

  await db
    .insert(schema.githubAppConfigs)
    .values({
      workspaceId: input.workspaceId,
      appId: String(input.app.id),
      appSlug: input.app.slug,
      appName: input.app.name,
      appHtmlUrl: input.app.html_url ?? null,
      privateKeyCiphertext,
      webhookSecretCiphertext,
      createdByUserId: input.userId,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: schema.githubAppConfigs.workspaceId,
      set: {
        appId: String(input.app.id),
        appSlug: input.app.slug,
        appName: input.app.name,
        appHtmlUrl: input.app.html_url ?? null,
        privateKeyCiphertext,
        webhookSecretCiphertext,
        updatedAt: now,
      },
    });
}

export async function resolveGitHubAppClientForWorkspace(
  workspaceId: string,
  override?: GitHubAppClient,
): Promise<GitHubAppClient | null> {
  if (override) return override;
  const config = await loadWorkspaceGitHubAppConfig(workspaceId);
  if (config) return config.client;
  return OPEN42_GITHUB_ENABLED ? new GitHubAppClient() : null;
}

export async function loadGitHubWebhookSecretForWorkspace(
  workspaceId: string | null,
): Promise<string | null> {
  if (!workspaceId) return GITHUB_WEBHOOK_SECRET || null;
  const config = await loadWorkspaceGitHubAppConfig(workspaceId);
  return config?.webhookSecret ?? (GITHUB_WEBHOOK_SECRET || null);
}

async function loadWorkspaceGitHubAppConfig(workspaceId: string): Promise<{
  client: GitHubAppClient;
  webhookSecret: string;
} | null> {
  const [row] = await defaultDb
    .select()
    .from(schema.githubAppConfigs)
    .where(eq(schema.githubAppConfigs.workspaceId, workspaceId))
    .limit(1);
  if (!row) return null;
  const privateKey = decryptSecret(row.privateKeyCiphertext, {
    workspaceId,
    purpose: 'github_app_private_key',
  });
  const webhookSecret = decryptSecret(row.webhookSecretCiphertext, {
    workspaceId,
    purpose: 'github_app_webhook_secret',
  });
  return {
    client: new GitHubAppClient({
      appId: row.appId,
      appSlug: row.appSlug,
      privateKey,
    }),
    webhookSecret,
  };
}

function validateManifestApp(value: Record<string, unknown>): GitHubManifestApp {
  const id = typeof value.id === 'number' || typeof value.id === 'string' ? value.id : null;
  const slug = typeof value.slug === 'string' ? value.slug : '';
  const name = typeof value.name === 'string' ? value.name : '';
  const pem = typeof value.pem === 'string' ? value.pem : '';
  const webhookSecret =
    typeof value.webhook_secret === 'string' ? value.webhook_secret : '';
  if (!id || !slug || !name || !pem || !webhookSecret) {
    throw new GitHubApiError('github manifest payload invalid', 502, 'github_manifest_invalid');
  }
  return {
    id,
    slug,
    name,
    html_url: typeof value.html_url === 'string' ? value.html_url : undefined,
    pem,
    webhook_secret: webhookSecret,
  };
}
