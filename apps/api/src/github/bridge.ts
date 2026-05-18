import { createHash, randomBytes } from 'node:crypto';

import { GITHUB_GIT_PROXY_PUBLIC_URL } from '../env.js';

export type GitHubSyncTransport = 'direct-url' | 'open42-git-proxy';

const MAX_PATH_FILTERS = 20;

export function createGbrainSourceId(): string {
  return `gh-${randomBytes(10).toString('hex')}`;
}

export function createGitProxyToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashGitProxyToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function directGithubCloneUrl(owner: string, repo: string): string {
  return `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}.git`;
}

export function proxiedGithubCloneUrl(input: {
  owner: string;
  repo: string;
  token: string;
}): string {
  if (!GITHUB_GIT_PROXY_PUBLIC_URL.startsWith('https://')) {
    throw new Error('github_git_proxy_requires_https_public_url');
  }
  const base = GITHUB_GIT_PROXY_PUBLIC_URL.replace(/\/+$/, '');
  return `${base}/git/github/${encodeURIComponent(input.token)}/${encodeURIComponent(
    input.owner,
  )}/${encodeURIComponent(input.repo)}.git`;
}

export function normalizeGithubPathFilters(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[\n,]/)
      : [];
  const seen = new Set<string>();
  const filters: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const normalized = normalizeGithubPathFilter(item);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    filters.push(normalized);
    if (filters.length >= MAX_PATH_FILTERS) break;
  }
  return filters;
}

function normalizeGithubPathFilter(value: string): string | null {
  const trimmed = value.trim().replace(/^\/+/, '').replace(/\/+$/, '');
  if (!trimmed) return null;
  if (trimmed.includes('..') || trimmed.length > 240) return null;
  if (!/^[A-Za-z0-9._/* -]+$/.test(trimmed)) return null;
  return trimmed;
}
