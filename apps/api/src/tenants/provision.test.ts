import { readFile } from 'node:fs/promises';

import { describe, expect, it, vi } from 'vitest';

import { decryptSecret } from '../crypto/envelope.js';
import type { TenantProvisionRepo } from './provision.js';
import {
  DEFAULT_GBRAIN_GIT_REF,
  classifyProvisioningError,
  gbrainGitRef,
  provisionTenant,
  registerTenantProvisioner,
  safelyProvisionTenant,
} from './provision.js';

describe('provisionTenant', () => {
  it('creates a local Docker gbrain tenant when selected', async () => {
    process.env.OPEN42_KEK = '3'.repeat(64);
    const stored: any[] = [];
    const commands: Array<{ file: string; args: string[] }> = [];
    const envFileBodies: string[] = [];
    const repo: TenantProvisionRepo = {
      async ensureWorkspaceForProvisioning() {
        return { id: 'workspace-local' };
      },
      async createWorkspace(input) {
        stored.push(input);
        return { id: 'workspace-local' };
      },
    };
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href === 'http://127.0.0.1:19001/health') {
        return json({ status: 'ok', version: '0.31.3' });
      }
      if (href === 'http://127.0.0.1:19001/register') {
        return json({ client_id: 'client-local', client_secret: 'secret-local' });
      }
      if (href === 'http://127.0.0.1:19001/token') {
        return json({ access_token: 'token-local', expires_in: 3600 });
      }
      throw new Error(`unexpected URL ${href}`);
    });

    await expect(
      provisionTenant({
        workspaceId: 'workspace-local',
        ownerUserId: 'user-local99',
        repo,
        fetch: fetchMock as typeof fetch,
        allocatePort: async () => 19001,
        sleep: async () => undefined,
        runCommand: async (file, args) => {
          commands.push({ file, args });
          if (args[0] === 'run') {
            const envFile = args[args.indexOf('--env-file') + 1];
            if (envFile) envFileBodies.push(await readFile(envFile, 'utf8'));
          }
          if (args[0] === 'image' && args[1] === 'inspect') {
            throw new Error('image missing');
          }
          if (args[0] === 'pull') {
            throw new Error('manifest unknown'); // force the build fallback
          }
          return { stdout: '', stderr: '' };
        },
        env: {
          TENANT_PROVISIONER: 'local-docker',
          GBRAIN_POSTGRES_PASSWORD: 'local-password',
          GBRAIN_VERSION: '0.31.3',
        },
      }),
    ).resolves.toEqual({
      workspaceId: 'workspace-local',
      tenantRuntimeId: 'open42-gbrain-workspac',
      gbrainPrivateAddress: '127.0.0.1:19001',
      gbrainBaseUrl: 'http://127.0.0.1:19001',
    });

    expect(
      commands.some((command) => command.args.includes('infra/Dockerfile.gbrain-tenant')),
    ).toBe(true);
    expect(
      commands.some((command) => command.args.includes('GBRAIN_POSTGRES_PASSWORD=local-password')),
    ).toBe(false);
    expect(
      commands.some((command) =>
        command.args.some((arg) => arg.startsWith('GBRAIN_DATABASE_URL=')),
      ),
    ).toBe(false);
    const dockerRun = commands.find((command) => command.args[0] === 'run');
    expect(dockerRun?.args).toContain('--env-file');
    expect(envFileBodies[0]).toContain('GBRAIN_POSTGRES_PASSWORD=local-password\n');
    expect(envFileBodies[0]).toContain('OPENAI_BASE_URL=http://');
    expect(envFileBodies[0]).toContain('ANTHROPIC_BASE_URL=http://');
    expect(dockerRun?.args).not.toContainEqual(
      expect.stringMatching(/^OPENAI_API_KEY=tnt_workspace-local_[0-9a-f]{32}$/),
    );
    expect(dockerRun?.args).not.toContainEqual(
      expect.stringMatching(/^OPENAI_BASE_URL=http:\/\/.+\/proxy\/openai\/v1$/),
    );
    expect(dockerRun?.args).not.toContainEqual(
      expect.stringMatching(/^ANTHROPIC_API_KEY=tnt_workspace-local_[0-9a-f]{32}$/),
    );
    expect(dockerRun?.args).not.toContainEqual(
      expect.stringMatching(/^ANTHROPIC_BASE_URL=http:\/\/.+\/proxy\/anthropic$/),
    );
    expect(stored[0]).toMatchObject({
      tenantRuntimeId: 'open42-gbrain-workspac',
      gbrainPrivateAddress: '127.0.0.1:19001',
      gbrainBaseUrl: 'http://127.0.0.1:19001',
      gbrainOauthClientId: 'client-local',
    });
    expect(
      decryptSecret(stored[0].gbrainOauthClientSecretCiphertext, {
        workspaceId: 'workspace-local',
        purpose: 'gbrain_oauth_secret',
      }),
    ).toBe('secret-local');
    expect(stored[0].proxyTokenHash).toBeInstanceOf(Buffer);
    expect(stored[0].proxyTokenHash).toHaveLength(32);
  });

  it('returns an existing workspace without provisioning another tenant', async () => {
    const repo: TenantProvisionRepo = {
      async findWorkspaceById(workspaceId) {
        expect(workspaceId).toBe('workspace-existing');
        return {
          workspaceId: 'workspace-existing',
          tenantRuntimeId: 'machine-existing',
          gbrainPrivateAddress: 'fdaa::2',
          gbrainBaseUrl: 'http://[fdaa::2]:8080',
        };
      },
      async createWorkspace() {
        throw new Error('should_not_create_workspace');
      },
    };
    const fetchMock = vi.fn();

    await expect(
      provisionTenant({
        workspaceId: 'workspace-existing',
        ownerUserId: 'user-existing',
        repo,
        fetch: fetchMock as typeof fetch,
        env: {
          TENANT_PROVISIONER: 'local-docker',
          GBRAIN_VERSION: '0.31.3',
        },
      }),
    ).resolves.toEqual({
      workspaceId: 'workspace-existing',
      tenantRuntimeId: 'machine-existing',
      gbrainPrivateAddress: 'fdaa::2',
      gbrainBaseUrl: 'http://[fdaa::2]:8080',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('routes a hybrid free workspace through the Hetzner tenant agent', async () => {
    process.env.OPEN42_KEK = '4'.repeat(64);
    const stored: any[] = [];
    const agentRequests: any[] = [];
    const repo: TenantProvisionRepo = {
      async ensureWorkspaceForProvisioning() {
        return { id: 'workspace-free' };
      },
      async resolveWorkspaceTenantTier(workspaceId) {
        expect(workspaceId).toBe('workspace-free');
        return 'free';
      },
      async createWorkspace(input) {
        stored.push(input);
        return { id: 'workspace-free' };
      },
    };
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      if (href === 'http://10.42.0.3:4317/tenants') {
        agentRequests.push({
          authorization: (init?.headers as Record<string, string>)?.Authorization,
          body: JSON.parse(String(init?.body)),
        });
        return json({
          tenantRuntimeId: 'open42-gbrain-free',
          gbrainPrivateAddress: '10.42.0.3:18080',
          gbrainBaseUrl: 'http://10.42.0.3:18080',
        });
      }
      if (href === 'http://10.42.0.3:18080/health') {
        return json({ status: 'ok', version: '0.31.3' });
      }
      if (href === 'http://10.42.0.3:18080/register') {
        return json({ client_id: 'client-free', client_secret: 'secret-free' });
      }
      if (href === 'http://10.42.0.3:18080/token') {
        return json({ access_token: 'token-free', expires_in: 3600 });
      }
      throw new Error(`unexpected URL ${href}`);
    });

    await expect(
      provisionTenant({
        workspaceId: 'workspace-free',
        ownerUserId: 'user-free',
        repo,
        fetch: fetchMock as typeof fetch,
        sleep: async () => undefined,
        env: {
          TENANT_PROVISIONER: 'hybrid',
          HETZNER_TENANT_AGENT_URL: 'http://10.42.0.3:4317',
          HETZNER_TENANT_AGENT_TOKEN: 'agent-token',
          API_PUBLIC_URL: 'https://api.open42.test',
          OPEN42_TENANT_PROXY_BASE_URL: 'http://open42-core.flycast',
          OPEN42_FREE_TENANT_PROXY_BASE_URL: 'https://api.open42.test',
          GBRAIN_TENANT_IMAGE: 'registry.example/open42/gbrain-tenant:v0.31.3',
          GBRAIN_VERSION: '0.31.3',
        },
      }),
    ).resolves.toEqual({
      workspaceId: 'workspace-free',
      tenantRuntimeId: 'open42-gbrain-free',
      gbrainPrivateAddress: '10.42.0.3:18080',
      gbrainBaseUrl: 'http://10.42.0.3:18080',
    });

    expect(agentRequests).toHaveLength(1);
    expect(agentRequests[0].authorization).toBe('Bearer agent-token');
    expect(agentRequests[0].body).toMatchObject({
      workspaceId: 'workspace-free',
      ownerUserId: 'user-free',
      image: 'registry.example/open42/gbrain-tenant:v0.31.3',
      gbrainVersion: '0.31.3',
      open42ApiBaseUrl: 'https://api.open42.test',
      postgres: { db: 'gbrain', user: 'gbrain' },
    });
    expect(agentRequests[0].body.proxyToken).toMatch(/^tnt_workspace-free_[0-9a-f]{32}$/);
    expect(stored[0]).toMatchObject({
      tenantRuntimeId: 'open42-gbrain-free',
      gbrainPrivateAddress: '10.42.0.3:18080',
      gbrainBaseUrl: 'http://10.42.0.3:18080',
      gbrainOauthClientId: 'client-free',
    });
    expect(
      decryptSecret(stored[0].gbrainOauthClientSecretCiphertext, {
        workspaceId: 'workspace-free',
        purpose: 'gbrain_oauth_secret',
      }),
    ).toBe('secret-free');
  });

  it('routes a hybrid private workspace through the configured private provisioner', async () => {
    process.env.OPEN42_KEK = '5'.repeat(64);
    const calls: Array<{ workspaceId: string; proxyToken: string }> = [];
    registerTenantProvisioner('test-private-provisioner', async (options) => {
      calls.push({ workspaceId: options.workspaceId, proxyToken: options.proxyToken });
      return {
        tenantRuntimeId: 'private-runtime',
        gbrainPrivateAddress: 'fdaa::42',
        gbrainBaseUrl: 'http://[fdaa::42]:8080',
      };
    });
    const repo: TenantProvisionRepo = {
      async ensureWorkspaceForProvisioning() {
        return { id: 'workspace-private' };
      },
      async resolveWorkspaceTenantTier() {
        return 'private';
      },
      async createWorkspace() {
        return { id: 'workspace-private' };
      },
    };
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href === 'http://[fdaa::42]:8080/health') {
        return json({ status: 'ok', version: '0.31.3' });
      }
      if (href === 'http://[fdaa::42]:8080/register') {
        return json({ client_id: 'client-private', client_secret: 'secret-private' });
      }
      if (href === 'http://[fdaa::42]:8080/token') {
        return json({ access_token: 'token-private', expires_in: 3600 });
      }
      throw new Error(`unexpected URL ${href}`);
    });

    await expect(
      provisionTenant({
        workspaceId: 'workspace-private',
        ownerUserId: 'user-private',
        repo,
        fetch: fetchMock as typeof fetch,
        sleep: async () => undefined,
        env: {
          TENANT_PROVISIONER: 'hybrid',
          OPEN42_PRIVATE_TENANT_PROVISIONER: 'test-private-provisioner',
          GBRAIN_VERSION: '0.31.3',
        },
      }),
    ).resolves.toEqual({
      workspaceId: 'workspace-private',
      tenantRuntimeId: 'private-runtime',
      gbrainPrivateAddress: 'fdaa::42',
      gbrainBaseUrl: 'http://[fdaa::42]:8080',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.workspaceId).toBe('workspace-private');
    expect(calls[0]?.proxyToken).toMatch(/^tnt_workspace-private_[0-9a-f]{32}$/);
  });
});

describe('gbrainGitRef', () => {
  const SHA = '9c60b3a068849f695034d82eb6c2b99287f9a054';

  it('returns the codebase default when GBRAIN_GIT_REF is unset', () => {
    expect(gbrainGitRef({}, 'production')).toBe(DEFAULT_GBRAIN_GIT_REF);
  });

  it('accepts a 40-char hex SHA in production', () => {
    expect(gbrainGitRef({ GBRAIN_GIT_REF: SHA }, 'production')).toBe(SHA);
  });

  it('rejects a branch ref in production', () => {
    expect(() =>
      gbrainGitRef({ GBRAIN_GIT_REF: 'garrytan/v0.31.3-multimodal' }, 'production'),
    ).toThrow(/40-char hex SHA/);
  });

  it('rejects a short SHA in production', () => {
    expect(() => gbrainGitRef({ GBRAIN_GIT_REF: '9c60b3a' }, 'production')).toThrow(
      /40-char hex SHA/,
    );
  });

  it('allows a branch ref outside production for local iteration', () => {
    expect(gbrainGitRef({ GBRAIN_GIT_REF: 'garrytan/v0.31.3-multimodal' }, 'development')).toBe(
      'garrytan/v0.31.3-multimodal',
    );
  });
});

describe('classifyProvisioningError', () => {
  it.each([
    ['Cannot connect to the Docker daemon at unix://', 'docker_unavailable'],
    ['ENOENT: no such file or directory, posix_spawnp /usr/bin/docker', 'docker_unavailable'],
    ['docker build returned exit code 1', 'image_build_failed'],
    ['docker run --name open42 failed', 'container_start_failed'],
    ['hetzner tenant agent failed: {"error":"no capacity"}', 'tenant_agent_unavailable'],
    ['hetzner tenant agent unavailable: TypeError: fetch failed', 'tenant_agent_unavailable'],
    ['gbrain tenant did not become healthy: 503', 'gbrain_health_timeout'],
    ['gbrain tenant did not become healthy: TypeError: fetch failed', 'gbrain_health_timeout'],
    ['failed to register OAuth client', 'oauth_registration_failed'],
    ['gbrain version mismatch: expected 0.31.3', 'gbrain_version_mismatch'],
    ['some unexpected non-matching message', 'provisioning_failed'],
  ])('classifies %j as %s', (msg, expected) => {
    expect(classifyProvisioningError(new Error(msg))).toBe(expected);
  });
});

describe('safelyProvisionTenant', () => {
  it('marks workspace failed and returns the classified error code on exception', async () => {
    const calls: Array<{ workspaceId: string; errorCode: string }> = [];
    const repo: TenantProvisionRepo = {
      async ensureWorkspaceForProvisioning() {
        return { id: 'workspace-error' };
      },
      async createWorkspace() {
        throw new Error('not reached');
      },
      async markWorkspaceFailedById(workspaceId, errorCode) {
        calls.push({ workspaceId, errorCode });
      },
    };
    const result = await safelyProvisionTenant({
      workspaceId: 'workspace-error',
      ownerUserId: 'user-9',
      repo,
      env: {
        TENANT_PROVISIONER: 'local-docker',
        GBRAIN_VERSION: '0.31.3',
      },
      runCommand: async () => {
        throw new Error('Cannot connect to the Docker daemon at unix:///var/run/docker.sock');
      },
      allocatePort: async () => 18080,
      sleep: async () => undefined,
      fetch: (async () => new Response('{}')) as unknown as typeof fetch,
    });
    expect(result).toEqual({ error: 'docker_unavailable' });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.workspaceId).toBe('workspace-error');
    expect(calls[0]?.errorCode).toBe('docker_unavailable');
  });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
