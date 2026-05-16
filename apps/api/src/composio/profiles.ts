import { and, eq, inArray, isNull, sql } from 'drizzle-orm';

import {
  COMPOSIO_API_KEY,
  COMPOSIO_BASE_URL,
  COMPOSIO_NOTION_AUTH_CONFIG_ID,
  OPEN42_COMPOSIO_ENABLED,
} from '../env.js';
import { decryptSecret, encryptSecret } from '../crypto/envelope.js';
import {
  findConnectableComposioServiceById,
  findComposioServiceById,
  serviceIdForConnectionKind,
  type ComposioServiceId,
  type SupportedComposioService,
} from '../connectors/catalog.js';
import { db as defaultDb, schema } from '../db/client.js';
import { createComposioClient, type ComposioClient } from './client.js';

export const OPEN42_MANAGED_COMPOSIO_PROFILE_ID = 'open42-managed';

export interface PublicConnectorAuthProfile {
  id: string;
  mode: 'open42_managed' | 'byok';
  label: string;
  provider: 'composio';
  services: Array<{
    serviceId: ComposioServiceId;
    configured: boolean;
    enabled: boolean;
  }>;
  createdAt: Date | null;
  updatedAt: Date | null;
  revokedAt?: Date | null;
}

export interface ResolvedComposioProfile {
  profileId: string | null;
  mode: 'open42_managed' | 'byok';
  service: SupportedComposioService;
  authConfigId: string;
  client: ComposioClient;
}

export interface UpsertComposioByokProfileInput {
  workspaceId: string;
  userId: string;
  profileId?: string | null;
  label?: string | null;
  apiKey: string;
  services: Partial<Record<ComposioServiceId, { authConfigId: string; enabled?: boolean }>>;
}

export interface DeleteComposioByokProfileInput {
  workspaceId: string;
  profileId: string;
}

export class ComposioProfileError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message = code,
  ) {
    super(message);
    this.name = 'ComposioProfileError';
  }
}

interface ProfileDeps {
  db?: typeof defaultDb;
  encrypt?: typeof encryptSecret;
  decrypt?: typeof decryptSecret;
  createClient?: typeof createComposioClient;
  env?: Partial<ProfileEnv>;
}

interface ProfileEnv {
  COMPOSIO_API_KEY: string;
  COMPOSIO_BASE_URL: string | undefined;
  COMPOSIO_NOTION_AUTH_CONFIG_ID: string;
  OPEN42_COMPOSIO_ENABLED: boolean;
}

type ConnectionLike = {
  id?: string;
  workspaceId: string;
  kind: string;
  serviceId?: string | null;
  connectorAuthProfileId?: string | null;
};

const clientCache = new Map<string, Promise<ComposioClient>>();

export async function listPublicConnectorAuthProfiles(
  workspaceId: string,
  deps: ProfileDeps = {},
): Promise<PublicConnectorAuthProfile[]> {
  const db = deps.db ?? defaultDb;
  const rows = await db
    .select({
      id: schema.connectorAuthProfiles.id,
      mode: schema.connectorAuthProfiles.mode,
      label: schema.connectorAuthProfiles.label,
      provider: schema.connectorAuthProfiles.provider,
      createdAt: schema.connectorAuthProfiles.createdAt,
      updatedAt: schema.connectorAuthProfiles.updatedAt,
      revokedAt: schema.connectorAuthProfiles.revokedAt,
    })
    .from(schema.connectorAuthProfiles)
    .where(
      and(
        eq(schema.connectorAuthProfiles.workspaceId, workspaceId),
        eq(schema.connectorAuthProfiles.provider, 'composio'),
        isNull(schema.connectorAuthProfiles.revokedAt),
      ),
    )
    .orderBy(schema.connectorAuthProfiles.createdAt);

  const profileIds = rows.map((row) => row.id);
  const serviceRows =
    profileIds.length === 0
      ? []
      : await db
          .select({
            profileId: schema.connectorAuthProfileServices.profileId,
            serviceId: schema.connectorAuthProfileServices.serviceId,
            enabled: schema.connectorAuthProfileServices.enabled,
          })
          .from(schema.connectorAuthProfileServices)
          .where(inArray(schema.connectorAuthProfileServices.profileId, profileIds));

  const servicesByProfile = new Map<string, PublicConnectorAuthProfile['services']>();
  for (const row of serviceRows) {
    const service = findComposioServiceById(row.serviceId);
    if (!service) continue;
    const services = servicesByProfile.get(row.profileId) ?? [];
    services.push({
      serviceId: service.serviceId,
      configured: true,
      enabled: row.enabled,
    });
    servicesByProfile.set(row.profileId, services);
  }

  return [
    managedProfileSummary(deps),
    ...rows.map((row) => ({
      id: row.id,
      mode: row.mode,
      label: row.label,
      provider: 'composio' as const,
      services: servicesByProfile.get(row.id) ?? [],
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      revokedAt: row.revokedAt,
    })),
  ];
}

export async function upsertComposioByokProfile(
  input: UpsertComposioByokProfileInput,
  deps: ProfileDeps = {},
): Promise<{ id: string }> {
  if (!input.workspaceId) throw new Error('upsertComposioByokProfile: workspaceId required');
  if (!input.userId) throw new Error('upsertComposioByokProfile: userId required');
  const apiKey = cleanSecret(input.apiKey);
  if (!apiKey) throw new ComposioProfileError('invalid_api_key', 400);
  const notionConfig = input.services.notion;
  const notionAuthConfigId = cleanSecret(notionConfig?.authConfigId);
  if (!notionAuthConfigId) {
    throw new ComposioProfileError('notion_auth_config_id_required', 400);
  }

  const db = deps.db ?? defaultDb;
  const encrypt = deps.encrypt ?? encryptSecret;
  const label = cleanLabel(input.label) ?? 'My Composio account';
  const now = new Date();
  const apiKeyCiphertext = encrypt(apiKey, {
    workspaceId: input.workspaceId,
    purpose: 'composio_api_key',
  });

  const profileId =
    input.profileId && input.profileId !== OPEN42_MANAGED_COMPOSIO_PROFILE_ID
      ? input.profileId
      : null;

  const [profile] = profileId
    ? await db
        .update(schema.connectorAuthProfiles)
        .set({
          label,
          apiKeyCiphertext,
          mode: 'byok',
          provider: 'composio',
          revokedAt: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(schema.connectorAuthProfiles.id, profileId),
            eq(schema.connectorAuthProfiles.workspaceId, input.workspaceId),
            eq(schema.connectorAuthProfiles.provider, 'composio'),
          ),
        )
        .returning({ id: schema.connectorAuthProfiles.id })
    : await db
        .insert(schema.connectorAuthProfiles)
        .values({
          workspaceId: input.workspaceId,
          provider: 'composio',
          mode: 'byok',
          label,
          apiKeyCiphertext,
          createdByUserId: input.userId,
        })
        .returning({ id: schema.connectorAuthProfiles.id });

  if (!profile) throw new ComposioProfileError('connector_auth_profile_not_found', 404);

  const authConfigIdCiphertext = encrypt(notionAuthConfigId, {
    workspaceId: input.workspaceId,
    purpose: 'composio_auth_config_id:notion',
  });

  await db
    .insert(schema.connectorAuthProfileServices)
    .values({
      profileId: profile.id,
      serviceId: 'notion',
      authConfigIdCiphertext,
      enabled: notionConfig?.enabled ?? true,
    })
    .onConflictDoUpdate({
      target: [
        schema.connectorAuthProfileServices.profileId,
        schema.connectorAuthProfileServices.serviceId,
      ],
      set: {
        authConfigIdCiphertext,
        enabled: notionConfig?.enabled ?? true,
        updatedAt: now,
      },
    });

  clientCache.delete(cacheKeyForByok(profile.id, now));
  return { id: profile.id };
}

export async function deleteComposioByokProfile(
  input: DeleteComposioByokProfileInput,
  deps: ProfileDeps = {},
): Promise<void> {
  if (input.profileId === OPEN42_MANAGED_COMPOSIO_PROFILE_ID) {
    throw new ComposioProfileError('cannot_delete_managed_profile', 400);
  }
  const db = deps.db ?? defaultDb;
  const activeConnections = await db
    .select({ id: schema.connections.id })
    .from(schema.connections)
    .where(
      and(
        eq(schema.connections.workspaceId, input.workspaceId),
        eq(schema.connections.connectorAuthProfileId, input.profileId),
        sql`${schema.connections.status} <> 'disconnected'`,
        isNull(schema.connections.deletedAt),
      ),
    )
    .limit(1);
  if (activeConnections.length > 0) {
    throw new ComposioProfileError('connector_auth_profile_in_use', 409);
  }

  await db
    .update(schema.connectorAuthProfiles)
    .set({ revokedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(schema.connectorAuthProfiles.id, input.profileId),
        eq(schema.connectorAuthProfiles.workspaceId, input.workspaceId),
        eq(schema.connectorAuthProfiles.provider, 'composio'),
      ),
    );
}

export async function resolveComposioProfileForInit(
  input: {
    workspaceId: string;
    serviceId: string;
    authProfileId?: string | null;
  },
  deps: ProfileDeps = {},
): Promise<ResolvedComposioProfile> {
  const service = findConnectableComposioServiceById(input.serviceId);
  if (!service) throw new ComposioProfileError('unsupported_composio_service', 400);
  const profileId = normalizeProfileId(input.authProfileId);
  if (!profileId) return resolveOpen42ManagedProfile(service, deps);
  return resolveByokProfile({ workspaceId: input.workspaceId, profileId, service }, deps);
}

export async function resolveComposioClientForConnection(
  connection: ConnectionLike,
  deps: ProfileDeps = {},
): Promise<ComposioClient> {
  const serviceId = connection.serviceId ?? serviceIdForConnectionKind(connection.kind);
  if (!serviceId) throw new ComposioProfileError('unsupported_composio_service', 400);
  const profile = await resolveComposioProfileForInit(
    {
      workspaceId: connection.workspaceId,
      serviceId,
      authProfileId: connection.connectorAuthProfileId ?? null,
    },
    deps,
  );
  return profile.client;
}

function managedProfileSummary(deps: ProfileDeps): PublicConnectorAuthProfile {
  const env = resolvedEnv(deps);
  return {
    id: OPEN42_MANAGED_COMPOSIO_PROFILE_ID,
    mode: 'open42_managed',
    label: 'Open42 managed Composio',
    provider: 'composio',
    services: [
      {
        serviceId: 'notion',
        configured: Boolean(env.OPEN42_COMPOSIO_ENABLED && env.COMPOSIO_NOTION_AUTH_CONFIG_ID),
        enabled: Boolean(env.OPEN42_COMPOSIO_ENABLED && env.COMPOSIO_NOTION_AUTH_CONFIG_ID),
      },
    ],
    createdAt: null,
    updatedAt: null,
  };
}

async function resolveOpen42ManagedProfile(
  service: SupportedComposioService,
  deps: ProfileDeps,
): Promise<ResolvedComposioProfile> {
  const env = resolvedEnv(deps);
  if (!env.OPEN42_COMPOSIO_ENABLED || !env.COMPOSIO_API_KEY) {
    throw new ComposioProfileError('composio_not_configured', 503);
  }
  const authConfigId = managedAuthConfigId(service.serviceId, env);
  if (!authConfigId) {
    throw new ComposioProfileError(`${service.serviceId}_auth_config_id_missing`, 503);
  }
  if (deps.createClient || deps.env) {
    return {
      profileId: null,
      mode: 'open42_managed',
      service,
      authConfigId,
      client: await (deps.createClient ?? createComposioClient)({
        apiKey: env.COMPOSIO_API_KEY,
        baseUrl: env.COMPOSIO_BASE_URL,
      }),
    };
  }
  const cacheKey = `managed:${service.serviceId}`;
  let client = clientCache.get(cacheKey);
  if (!client) {
    client = (deps.createClient ?? createComposioClient)({
      apiKey: env.COMPOSIO_API_KEY,
      baseUrl: env.COMPOSIO_BASE_URL,
    });
    clientCache.set(cacheKey, client);
  }
  return {
    profileId: null,
    mode: 'open42_managed',
    service,
    authConfigId,
    client: await client,
  };
}

async function resolveByokProfile(
  input: { workspaceId: string; profileId: string; service: SupportedComposioService },
  deps: ProfileDeps,
): Promise<ResolvedComposioProfile> {
  const db = deps.db ?? defaultDb;
  const decrypt = deps.decrypt ?? decryptSecret;
  const [row] = await db
    .select({
      id: schema.connectorAuthProfiles.id,
      workspaceId: schema.connectorAuthProfiles.workspaceId,
      mode: schema.connectorAuthProfiles.mode,
      apiKeyCiphertext: schema.connectorAuthProfiles.apiKeyCiphertext,
      baseUrl: schema.connectorAuthProfiles.baseUrl,
      updatedAt: schema.connectorAuthProfiles.updatedAt,
    })
    .from(schema.connectorAuthProfiles)
    .where(
      and(
        eq(schema.connectorAuthProfiles.id, input.profileId),
        eq(schema.connectorAuthProfiles.workspaceId, input.workspaceId),
        eq(schema.connectorAuthProfiles.provider, 'composio'),
        isNull(schema.connectorAuthProfiles.revokedAt),
      ),
    )
    .limit(1);

  if (!row || row.mode !== 'byok' || !row.apiKeyCiphertext) {
    throw new ComposioProfileError('connector_auth_profile_not_found', 404);
  }

  const [serviceRow] = await db
    .select({
      authConfigIdCiphertext: schema.connectorAuthProfileServices.authConfigIdCiphertext,
      enabled: schema.connectorAuthProfileServices.enabled,
    })
    .from(schema.connectorAuthProfileServices)
    .where(
      and(
        eq(schema.connectorAuthProfileServices.profileId, row.id),
        eq(schema.connectorAuthProfileServices.serviceId, input.service.serviceId),
      ),
    )
    .limit(1);

  if (!serviceRow || !serviceRow.enabled) {
    throw new ComposioProfileError('connector_auth_profile_service_not_configured', 400);
  }

  const apiKey = decrypt(row.apiKeyCiphertext, {
    workspaceId: input.workspaceId,
    purpose: 'composio_api_key',
  });
  const authConfigId = decrypt(serviceRow.authConfigIdCiphertext, {
    workspaceId: input.workspaceId,
    purpose: `composio_auth_config_id:${input.service.serviceId}`,
  });

  const cacheKey = cacheKeyForByok(row.id, row.updatedAt);
  let client = clientCache.get(cacheKey);
  if (!client) {
    client = (deps.createClient ?? createComposioClient)({
      apiKey,
      baseUrl: row.baseUrl ?? undefined,
    });
    clientCache.set(cacheKey, client);
  }
  return {
    profileId: row.id,
    mode: 'byok',
    service: input.service,
    authConfigId,
    client: await client,
  };
}

function normalizeProfileId(value: string | null | undefined): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed || trimmed === OPEN42_MANAGED_COMPOSIO_PROFILE_ID) return null;
  return trimmed;
}

function managedAuthConfigId(serviceId: ComposioServiceId, env: ProfileEnv): string {
  switch (serviceId) {
    case 'notion':
      return env.COMPOSIO_NOTION_AUTH_CONFIG_ID ?? '';
    case 'slack':
    case 'gdocs':
      return '';
  }
}

function resolvedEnv(deps: ProfileDeps): ProfileEnv {
  return {
    COMPOSIO_API_KEY: deps.env?.COMPOSIO_API_KEY ?? COMPOSIO_API_KEY,
    COMPOSIO_BASE_URL: deps.env?.COMPOSIO_BASE_URL ?? COMPOSIO_BASE_URL,
    COMPOSIO_NOTION_AUTH_CONFIG_ID:
      deps.env?.COMPOSIO_NOTION_AUTH_CONFIG_ID ?? COMPOSIO_NOTION_AUTH_CONFIG_ID,
    OPEN42_COMPOSIO_ENABLED: deps.env?.OPEN42_COMPOSIO_ENABLED ?? OPEN42_COMPOSIO_ENABLED,
  };
}

function cacheKeyForByok(profileId: string, updatedAt: Date): string {
  return `byok:${profileId}:${updatedAt.getTime()}`;
}

function cleanSecret(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 512) return null;
  return trimmed;
}

function cleanLabel(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 80) return null;
  return trimmed;
}
