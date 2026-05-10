import { readFile } from 'node:fs/promises';

import { describe, expect, it, vi } from 'vitest';

import { decryptSecret } from '../crypto/envelope.js';
import type { TenantProvisionRepo } from './provision.js';
import {
  DEFAULT_GBRAIN_GIT_REF,
  classifyProvisioningError,
  gbrainGitRef,
  provisionTenant,
  safelyProvisionTenant,
} from './provision.js';

describe('provisionTenant', () => {
  it('creates a Fly machine, registers gbrain OAuth, encrypts the secret, and stores workspace metadata', async () => {
    process.env.OPEN42_KEK = '2'.repeat(64);
    const stored: any[] = [];
    const repo: TenantProvisionRepo = {
      async reserveWorkspaceForOwner() {
        return { id: 'workspace-1' };
      },
      async createWorkspace(input) {
        stored.push(input);
        return { id: 'workspace-1' };
      },
    };
    const flyRequests: Array<{ href: string; body?: any }> = [];
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      if (href.includes('api.machines.dev')) {
        flyRequests.push({
          href,
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
        });
      }
      if (href.endsWith('/volumes')) {
        return json({ id: 'volume-1' });
      }
      if (href.endsWith('/machines')) {
        return json({ id: 'machine-1', private_ip: 'fdaa::1' });
      }
      if (href === 'http://[fdaa::1]:8080/register') {
        return json({ client_id: 'client-1', client_secret: 'secret-1' });
      }
      if (href === 'http://[fdaa::1]:8080/token') {
        return json({ access_token: 'token-1', expires_in: 3600 });
      }
      if (href === 'http://[fdaa::1]:8080/health') {
        return json({ status: 'ok', version: '0.31.3' });
      }
      throw new Error(`unexpected URL ${href}`);
    });

    await expect(
      provisionTenant({
        ownerUserId: 'user-12345678',
        repo,
        fetch: fetchMock as typeof fetch,
        env: {
          TENANT_PROVISIONER: 'fly',
          FLY_API_TOKEN: 'fly-token',
          FLY_TENANTS_APP_NAME: 'open42-tenants',
          GBRAIN_VERSION: '0.31.3',
        },
      }),
    ).resolves.toEqual({
      workspaceId: 'workspace-1',
      flyMachineId: 'machine-1',
      flyPrivateIp: 'fdaa::1',
      gbrainBaseUrl: 'http://[fdaa::1]:8080',
    });

    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      ownerUserId: 'user-12345678',
      flyMachineId: 'machine-1',
      flyPrivateIp: 'fdaa::1',
      gbrainBaseUrl: 'http://[fdaa::1]:8080',
      gbrainOauthClientId: 'client-1',
      gbrainVersion: '0.31.3',
    });
    expect(
      decryptSecret(stored[0].gbrainOauthClientSecretCiphertext, {
        workspaceId: 'workspace-1',
        purpose: 'gbrain_oauth_secret',
      }),
    ).toBe('secret-1');
    expect(stored[0].proxyTokenHash).toBeInstanceOf(Buffer);
    expect(stored[0].proxyTokenHash).toHaveLength(32);
    const volumeRequest = flyRequests.find((request) => request.href.endsWith('/volumes'));
    expect(volumeRequest?.body.name).toBe('open42_gbrain_user_12345678');
    const machineRequest = flyRequests.find((request) => request.href.endsWith('/machines'));
    expect(machineRequest?.body.config.mounts).toEqual([{ path: '/data', volume: 'volume-1' }]);
    expect(machineRequest?.body.config.env).not.toHaveProperty('GBRAIN_DATABASE_URL');
    expect(machineRequest?.body.config.env.OPENAI_API_KEY).toMatch(
      /^tnt_workspace-1_[0-9a-f]{32}$/,
    );
    expect(machineRequest?.body.config.env.OPENAI_BASE_URL).toBe(
      'http://open42-api.flycast/proxy/openai/v1',
    );
    expect(machineRequest?.body.config.env.ANTHROPIC_API_KEY).toBe(
      machineRequest?.body.config.env.OPENAI_API_KEY,
    );
    expect(machineRequest?.body.config.env.ANTHROPIC_BASE_URL).toBe(
      'http://open42-api.flycast/proxy/anthropic',
    );
  });

  it('creates a local Docker gbrain tenant when Fly is not configured', async () => {
    process.env.OPEN42_KEK = '3'.repeat(64);
    const stored: any[] = [];
    const commands: Array<{ file: string; args: string[] }> = [];
    const envFileBodies: string[] = [];
    const repo: TenantProvisionRepo = {
      async reserveWorkspaceForOwner() {
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
      flyMachineId: 'open42-gbrain-user-loc',
      flyPrivateIp: '127.0.0.1:19001',
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
      flyMachineId: 'open42-gbrain-user-loc',
      flyPrivateIp: '127.0.0.1:19001',
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

  it('defaults to local Docker in development even when Fly credentials are present', async () => {
    process.env.OPEN42_KEK = '4'.repeat(64);
    const stored: any[] = [];
    const repo: TenantProvisionRepo = {
      async reserveWorkspaceForOwner() {
        return { id: 'workspace-local-with-fly-env' };
      },
      async createWorkspace(input) {
        stored.push(input);
        return { id: 'workspace-local-with-fly-env' };
      },
    };
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href === 'http://127.0.0.1:19002/health') {
        return json({ status: 'ok', version: '0.31.3' });
      }
      if (href === 'http://127.0.0.1:19002/register') {
        return json({ client_id: 'client-local-fly-env', client_secret: 'secret-local-fly-env' });
      }
      if (href === 'http://127.0.0.1:19002/token') {
        return json({ access_token: 'token-local-fly-env', expires_in: 3600 });
      }
      throw new Error(`unexpected URL ${href}`);
    });

    await expect(
      provisionTenant({
        ownerUserId: 'user-flyenv1',
        repo,
        fetch: fetchMock as typeof fetch,
        allocatePort: async () => 19002,
        sleep: async () => undefined,
        runCommand: async () => ({ stdout: '', stderr: '' }),
        env: {
          FLY_API_TOKEN: 'fly-token',
          FLY_TENANTS_APP_NAME: 'open42-tenants',
          GBRAIN_VERSION: '0.31.3',
        },
      }),
    ).resolves.toMatchObject({
      workspaceId: 'workspace-local-with-fly-env',
      flyMachineId: 'open42-gbrain-user-fly',
      flyPrivateIp: '127.0.0.1:19002',
    });

    expect(stored[0]).toMatchObject({
      flyMachineId: 'open42-gbrain-user-fly',
      gbrainBaseUrl: 'http://127.0.0.1:19002',
      gbrainOauthClientId: 'client-local-fly-env',
    });
  });

  it('returns an existing workspace without provisioning another tenant', async () => {
    const repo: TenantProvisionRepo = {
      async findWorkspaceForOwner(ownerUserId) {
        expect(ownerUserId).toBe('user-existing');
        return {
          workspaceId: 'workspace-existing',
          flyMachineId: 'machine-existing',
          flyPrivateIp: 'fdaa::2',
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
        ownerUserId: 'user-existing',
        repo,
        fetch: fetchMock as typeof fetch,
        env: {
          TENANT_PROVISIONER: 'fly',
          FLY_API_TOKEN: 'fly-token',
          FLY_TENANTS_APP_NAME: 'open42-tenants',
          GBRAIN_VERSION: '0.31.3',
        },
      }),
    ).resolves.toEqual({
      workspaceId: 'workspace-existing',
      flyMachineId: 'machine-existing',
      flyPrivateIp: 'fdaa::2',
      gbrainBaseUrl: 'http://[fdaa::2]:8080',
    });
    expect(fetchMock).not.toHaveBeenCalled();
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
    expect(
      gbrainGitRef({ GBRAIN_GIT_REF: 'garrytan/v0.31.3-multimodal' }, 'development'),
    ).toBe('garrytan/v0.31.3-multimodal');
  });
});

describe('classifyProvisioningError', () => {
  it.each([
    ['Cannot connect to the Docker daemon at unix://', 'docker_unavailable'],
    ['ENOENT: no such file or directory, posix_spawnp /usr/bin/docker', 'docker_unavailable'],
    ['docker build returned exit code 1', 'image_build_failed'],
    ['docker run --name open42 failed', 'container_start_failed'],
    ['gbrain tenant did not become healthy: 503', 'gbrain_health_timeout'],
    ['failed to register OAuth client', 'oauth_registration_failed'],
    ['gbrain version mismatch: expected 0.31.3', 'gbrain_version_mismatch'],
    ['Fly API returned 500', 'fly_api_failed'],
    ['some unexpected non-matching message', 'provisioning_failed'],
  ])('classifies %j as %s', (msg, expected) => {
    expect(classifyProvisioningError(new Error(msg))).toBe(expected);
  });
});

describe('safelyProvisionTenant', () => {
  it('marks workspace failed and returns the classified error code on exception', async () => {
    const calls: Array<{ ownerUserId: string; errorCode: string }> = [];
    const repo: TenantProvisionRepo = {
      async reserveWorkspaceForOwner() {
        return { id: 'workspace-error' };
      },
      async createWorkspace() {
        throw new Error('not reached');
      },
      async markWorkspaceFailedForOwner(ownerUserId, errorCode) {
        calls.push({ ownerUserId, errorCode });
      },
    };
    const result = await safelyProvisionTenant({
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
    expect(calls[0]?.ownerUserId).toBe('user-9');
    expect(calls[0]?.errorCode).toBe('docker_unavailable');
  });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
