/**
 * Open42 Postgres schema (Drizzle).
 * Matches the schema in ENGINEERING.md §"Database schema (P1)".
 *
 * gbrain has its own pgvector store inside each tenant's Fly machine.
 * This schema is Open42's metadata only — auth, workspaces, audit, jobs.
 */
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  integer,
  boolean,
  customType,
  primaryKey,
  index,
  uniqueIndex,
  jsonb,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * Drizzle ships no built-in bytea — define one for the encrypted
 * gbrain client-secret column. Stored as Buffer at the JS layer.
 */
const bytea = customType<{ data: Buffer; default: false }>({
  dataType() {
    return 'bytea';
  },
});

// =====================================================================
// Enums
// =====================================================================

export const membershipRoleEnum = pgEnum('membership_role', ['owner', 'member']);
export const workspaceStatusEnum = pgEnum('workspace_status', [
  'provisioning',
  'ready',
  'failed',
  'deleted',
]);
export const skillTypeEnum = pgEnum('skill_type', ['refund-policy']);
export const ingestStatusEnum = pgEnum('ingest_status', [
  'pending',
  'running',
  'completed',
  'failed',
]);
export const connectionKindEnum = pgEnum('connection_kind', [
  'notion-composio',
  'notion-zip',
]);
export const connectionStatusEnum = pgEnum('connection_status', [
  'pending_import',
  'active',
  'paused',
  'completed',
  'errored',
  'disconnected',
]);
export const ingestModeEnum = pgEnum('ingest_mode', ['import_once', 'periodic_pull']);

// =====================================================================
// users
// =====================================================================

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  supabaseUserId: text('supabase_user_id').unique(),
  email: text('email').notNull().unique(),
  currentWorkspaceId: uuid('current_workspace_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// =====================================================================
// workspaces
// =====================================================================

export const workspaces = pgTable(
  'workspaces',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    flyMachineId: text('fly_machine_id'),
    flyPrivateIp: text('fly_private_ip'),
    gbrainBaseUrl: text('gbrain_base_url'),
    gbrainOauthClientId: text('gbrain_oauth_client_id'),
    // AES-GCM(client_secret, OPEN42_KEK). Plaintext NEVER stored.
    gbrainOauthClientSecretCiphertext: bytea('gbrain_oauth_client_secret_ciphertext'),
    gbrainVersion: text('gbrain_version').notNull(),
    status: workspaceStatusEnum('status').notNull().default('provisioning'),
    ingestMode: ingestModeEnum('ingest_mode').notNull().default('periodic_pull'),
    ingestIntervalHours: integer('ingest_interval_hours').notNull().default(1),
    ingestLastCycleAt: timestamp('ingest_last_cycle_at', { withTimezone: true }),
    ingestLockUntil: timestamp('ingest_lock_until', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    ingestIntervalCheck: check(
      'workspaces_ingest_interval_hours_range',
      sql`${t.ingestIntervalHours} BETWEEN 1 AND 168`,
    ),
  }),
);

// =====================================================================
// memberships (N:N — P1 only has owner rows; P2 multiplayer adds members)
// =====================================================================

export const memberships = pgTable(
  'memberships',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    role: membershipRoleEnum('role').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.workspaceId] }),
    workspaceIdx: index('memberships_workspace_idx').on(t.workspaceId),
  }),
);

// =====================================================================
// sessions (server-side session store — cookie holds session.id)
// =====================================================================

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    csrfToken: text('csrf_token').notNull(),
    userAgent: text('user_agent'),
    ipFirstOctet: text('ip_first_octet'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('sessions_user_idx').on(t.userId),
    expiresIdx: index('sessions_expires_idx').on(t.expiresAt),
  }),
);

// =====================================================================
// skill_exports (audit log of generated skills)
// =====================================================================

export const skillExports = pgTable(
  'skill_exports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'set null' }),
    skillType: skillTypeEnum('skill_type').notNull(),
    generatedAt: timestamp('generated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    citationsCount: integer('citations_count').notNull(),
    sourcePagesOldestAt: timestamp('source_pages_oldest_at', { withTimezone: true }),
    stalenessWarning: boolean('staleness_warning').notNull().default(false),
  },
  (t) => ({
    workspaceIdx: index('skill_exports_workspace_idx').on(t.workspaceId),
    generatedIdx: index('skill_exports_generated_idx').on(t.generatedAt),
  }),
);

// =====================================================================
// ingest_jobs (mirror of gbrain submit_job for Open42-side tracking)
// =====================================================================

export const ingestJobs = pgTable(
  'ingest_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    gbrainJobId: text('gbrain_job_id'),
    status: ingestStatusEnum('status').notNull().default('pending'),
    pagesTotal: integer('pages_total').notNull().default(0),
    connectorsSummary: jsonb('connectors_summary').notNull().default(sql`'[]'::jsonb`),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    workspaceIdx: index('ingest_jobs_workspace_idx').on(t.workspaceId),
    statusIdx: index('ingest_jobs_status_idx').on(t.status),
  }),
);

// =====================================================================
// connections (per-workspace third-party data sources)
// =====================================================================

export const connections = pgTable(
  'connections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    kind: connectionKindEnum('kind').notNull(),
    status: connectionStatusEnum('status').notNull().default('pending_import'),
    displayName: text('display_name').notNull(),
    composioConnectedAccountId: text('composio_connected_account_id'),
    cursor: jsonb('cursor').notNull().default(sql`'{}'::jsonb`),
    lastPulledAt: timestamp('last_pulled_at', { withTimezone: true }),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    workspaceStatusIdx: index('connections_workspace_status_idx').on(t.workspaceId, t.status),
    // Source of truth for one-Notion-per-workspace rule. Partial unique index;
    // disconnected rows do not count.
    oneNotionPerWorkspace: uniqueIndex('connections_one_notion_per_workspace')
      .on(t.workspaceId)
      .where(sql`${t.kind}::text LIKE 'notion-%' AND ${t.status} <> 'disconnected'`),
    composioAccountUniq: uniqueIndex('connections_composio_account_uniq')
      .on(t.composioConnectedAccountId)
      .where(sql`${t.composioConnectedAccountId} IS NOT NULL AND ${t.status} <> 'disconnected'`),
  }),
);

// =====================================================================
// connection_init_states (OAuth CSRF / state binding scratchpad)
// =====================================================================

export const connectionInitStates = pgTable(
  'connection_init_states',
  {
    state: text('state').primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: connectionKindEnum('kind').notNull(),
    composioPendingId: text('composio_pending_id'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    expiresIdx: index('connection_init_states_expires_idx').on(t.expiresAt),
  }),
);

// =====================================================================
// Inferred types — re-export for use elsewhere in the API.
// =====================================================================

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Workspace = typeof workspaces.$inferSelect;
export type NewWorkspace = typeof workspaces.$inferInsert;
export type Membership = typeof memberships.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type SkillExport = typeof skillExports.$inferSelect;
export type IngestJob = typeof ingestJobs.$inferSelect;
export type Connection = typeof connections.$inferSelect;
export type NewConnection = typeof connections.$inferInsert;
export type ConnectionInitState = typeof connectionInitStates.$inferSelect;
export type NewConnectionInitState = typeof connectionInitStates.$inferInsert;
