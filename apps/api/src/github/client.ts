import { createSign } from 'node:crypto';

import {
  GITHUB_APP_ID,
  GITHUB_APP_PRIVATE_KEY,
  GITHUB_APP_SLUG,
} from '../env.js';

type Fetch = typeof fetch;

export interface GitHubClientDeps {
  fetch?: Fetch;
  now?: () => number;
  appId?: string;
  appSlug?: string;
  privateKey?: string;
  apiBaseUrl?: string;
  webBaseUrl?: string;
}

export interface GitHubInstallationRepository {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  default_branch: string;
  owner: { login: string };
}

export interface GitHubTreeEntry {
  path?: string;
  mode?: string;
  type?: string;
  sha?: string;
  size?: number;
  url?: string;
}

export interface GitHubBranchHead {
  sha: string;
  treeSha: string;
}

export class GitHubApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code: string = 'github_api_error',
  ) {
    super(message);
    this.name = 'GitHubApiError';
  }
}

export class GitHubAuthRequiredError extends GitHubApiError {
  constructor(status?: number) {
    super('github auth required', status, 'github_auth_required');
    this.name = 'GitHubAuthRequiredError';
  }
}

export class GitHubAppClient {
  private readonly fetchImpl: Fetch;
  private readonly now: () => number;
  private readonly appId: string;
  private readonly appSlug: string;
  private readonly privateKey: string;
  private readonly apiBaseUrl: string;
  private readonly webBaseUrl: string;

  constructor(deps: GitHubClientDeps = {}) {
    this.fetchImpl = deps.fetch ?? fetch;
    this.now = deps.now ?? Date.now;
    this.appId = deps.appId ?? GITHUB_APP_ID;
    this.appSlug = deps.appSlug ?? GITHUB_APP_SLUG;
    this.privateKey = deps.privateKey ?? GITHUB_APP_PRIVATE_KEY;
    this.apiBaseUrl = (deps.apiBaseUrl ?? 'https://api.github.com').replace(/\/+$/, '');
    this.webBaseUrl = (deps.webBaseUrl ?? 'https://github.com').replace(/\/+$/, '');
  }

  isConfigured(): boolean {
    return Boolean(this.appId && this.appSlug && this.privateKey);
  }

  installUrl(state: string): string {
    if (!this.appSlug) {
      throw new GitHubApiError('github app not configured', 503, 'github_not_configured');
    }
    const url = new URL(`${this.webBaseUrl}/apps/${this.appSlug}/installations/new`);
    url.searchParams.set('state', state);
    return url.toString();
  }

  async createInstallationToken(installationId: string): Promise<string> {
    const payload = await this.requestJson<{ token?: string }>(
      `/app/installations/${encodeURIComponent(installationId)}/access_tokens`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.createAppJwt()}`,
        },
      },
    );
    if (!payload.token) {
      throw new GitHubApiError('github token missing', 502, 'github_token_missing');
    }
    return payload.token;
  }

  async listInstallationRepositories(installationId: string): Promise<GitHubInstallationRepository[]> {
    const token = await this.createInstallationToken(installationId);
    const repos: GitHubInstallationRepository[] = [];
    let page = 1;
    while (page <= 10) {
      const payload = await this.requestJson<{
        repositories?: GitHubInstallationRepository[];
      }>(`/installation/repositories?per_page=100&page=${page}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const batch = payload.repositories ?? [];
      repos.push(...batch);
      if (batch.length < 100) break;
      page += 1;
    }
    return repos;
  }

  async getBranchHead(input: {
    installationId: string;
    owner: string;
    repo: string;
    branch: string;
  }): Promise<GitHubBranchHead> {
    const token = await this.createInstallationToken(input.installationId);
    const branch = await this.requestJson<{
      commit?: { sha?: string; commit?: { tree?: { sha?: string } } };
    }>(
      `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/branches/${encodeURIComponent(
        input.branch,
      )}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const sha = branch.commit?.sha;
    const treeSha = branch.commit?.commit?.tree?.sha;
    if (!sha || !treeSha) {
      throw new GitHubApiError('github branch payload invalid', 502, 'github_branch_invalid');
    }
    return { sha, treeSha };
  }

  async getTree(input: {
    installationId: string;
    owner: string;
    repo: string;
    treeSha: string;
  }): Promise<GitHubTreeEntry[]> {
    const token = await this.createInstallationToken(input.installationId);
    const payload = await this.requestJson<{ tree?: GitHubTreeEntry[]; truncated?: boolean }>(
      `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/git/trees/${encodeURIComponent(
        input.treeSha,
      )}?recursive=1`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (payload.truncated) {
      throw new GitHubApiError('github tree truncated', 422, 'github_tree_truncated');
    }
    return payload.tree ?? [];
  }

  async getBlobText(input: {
    installationId: string;
    owner: string;
    repo: string;
    sha: string;
  }): Promise<string> {
    const token = await this.createInstallationToken(input.installationId);
    const payload = await this.requestJson<{ content?: string; encoding?: string }>(
      `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/git/blobs/${encodeURIComponent(
        input.sha,
      )}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (payload.encoding !== 'base64' || typeof payload.content !== 'string') {
      throw new GitHubApiError('github blob payload invalid', 502, 'github_blob_invalid');
    }
    return Buffer.from(payload.content.replace(/\s+/g, ''), 'base64').toString('utf8');
  }

  private async requestJson<T>(path: string, init: RequestInit): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/vnd.github+json');
    headers.set('X-GitHub-Api-Version', '2022-11-28');
    headers.set('User-Agent', 'open42');
    const response = await this.fetchImpl(`${this.apiBaseUrl}${path}`, {
      ...init,
      headers,
    });
    if (!response.ok) {
      if ([401, 403, 404].includes(response.status)) {
        throw new GitHubAuthRequiredError(response.status);
      }
      throw new GitHubApiError('github request failed', response.status, `github_${response.status}`);
    }
    return (await response.json()) as T;
  }

  private createAppJwt(): string {
    if (!this.appId || !this.privateKey) {
      throw new GitHubApiError('github app not configured', 503, 'github_not_configured');
    }
    const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const nowSeconds = Math.floor(this.now() / 1000);
    const payload = base64url(
      JSON.stringify({
        iat: nowSeconds - 60,
        exp: nowSeconds + 9 * 60,
        iss: this.appId,
      }),
    );
    const unsigned = `${header}.${payload}`;
    const privateKey = this.privateKey.replace(/\\n/g, '\n');
    const signature = createSign('RSA-SHA256').update(unsigned).sign(privateKey);
    return `${unsigned}.${base64url(signature)}`;
  }
}

export function sanitizeGithubError(err: unknown): string {
  if (err instanceof GitHubAuthRequiredError) return 'github_auth_required';
  if (err instanceof GitHubApiError) return err.code;
  if (err instanceof Error && SAFE_ERROR_CODES.has(err.message)) return err.message;
  return 'github_sync_failed';
}

const SAFE_ERROR_CODES = new Set([
  'github_file_too_many',
  'github_content_budget_exceeded',
  'github_not_configured',
  'github_git_proxy_requires_https_public_url',
  'github_tree_truncated',
]);

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url');
}
