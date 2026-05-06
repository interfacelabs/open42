import { describe, expect, it, vi } from 'vitest';

import { decryptSecret } from '../crypto/envelope.js';
import type { TenantProvisionRepo } from './provision.js';
import { provisionTenant } from './provision.js';

describe('provisionTenant', () => {
  it('creates a Fly machine, registers gbrain OAuth, encrypts the secret, and stores workspace metadata', async () => {
    process.env.OPEN42_KEK = '2'.repeat(64);
    const stored: any[] = [];
    const repo: TenantProvisionRepo = {
      async createWorkspace(input) {
        stored.push(input);
        return { id: 'workspace-1' };
      },
    };
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.includes('api.machines.dev')) {
        return json({ id: 'machine-1', private_ip: 'fdaa::1' });
      }
      if (href === 'http://[fdaa::1]:8080/register') {
        return json({ client_id: 'client-1', client_secret: 'secret-1' });
      }
      if (href === 'http://[fdaa::1]:8080/token') {
        return json({ access_token: 'token-1', expires_in: 3600 });
      }
      if (href === 'http://[fdaa::1]:8080/health') {
        return json({ status: 'ok', version: '0.27.1' });
      }
      throw new Error(`unexpected URL ${href}`);
    });

    await expect(
      provisionTenant({
        ownerUserId: 'user-12345678',
        repo,
        fetch: fetchMock as typeof fetch,
        env: {
          FLY_API_TOKEN: 'fly-token',
          FLY_TENANTS_APP_NAME: 'open42-tenants',
          GBRAIN_VERSION: '0.27.1',
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
      gbrainVersion: '0.27.1',
    });
    expect(decryptSecret(stored[0].gbrainOauthClientSecretCiphertext)).toBe('secret-1');
  });

  it('creates a local Docker gbrain tenant when Fly is not configured', async () => {
    process.env.OPEN42_KEK = '3'.repeat(64);
    const stored: any[] = [];
    const commands: Array<{ file: string; args: string[] }> = [];
    const repo: TenantProvisionRepo = {
      async createWorkspace(input) {
        stored.push(input);
        return { id: 'workspace-local' };
      },
    };
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href === 'http://127.0.0.1:19001/health') {
        return json({ status: 'ok', version: '0.27.1' });
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
          if (args[0] === 'image' && args[1] === 'inspect') {
            throw new Error('image missing');
          }
          return { stdout: '', stderr: '' };
        },
        env: {
          TENANT_PROVISIONER: 'local-docker',
          GBRAIN_VERSION: '0.27.1',
        },
      }),
    ).resolves.toEqual({
      workspaceId: 'workspace-local',
      flyMachineId: 'open42-gbrain-user-loc',
      flyPrivateIp: '127.0.0.1:19001',
      gbrainBaseUrl: 'http://127.0.0.1:19001',
    });

    expect(commands.some((command) => command.args.includes('infra/Dockerfile.gbrain-tenant'))).toBe(
      true,
    );
    expect(commands.some((command) => command.args.includes('run'))).toBe(true);
    expect(stored[0]).toMatchObject({
      flyMachineId: 'open42-gbrain-user-loc',
      flyPrivateIp: '127.0.0.1:19001',
      gbrainBaseUrl: 'http://127.0.0.1:19001',
      gbrainOauthClientId: 'client-local',
    });
    expect(decryptSecret(stored[0].gbrainOauthClientSecretCiphertext)).toBe('secret-local');
  });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
