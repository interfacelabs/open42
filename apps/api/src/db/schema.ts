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

export const membershipRoleEnum = pgEnum('membership_role', ['owner', 'admin', 'member']);
export const workspaceStatusEnum = pgEnum('workspace_status', [
  'provisioning',
  'ready',
  'failed',
  'deleted',
]);
export const workspacePlanEnum = pgEnum('workspace_plan', ['starter', 'team', 'business']);
export const workspaceBillingModeEnum = pgEnum('workspace_billing_mode', ['platform', 'byok']);
export const workspaceInviteStatusEnum = pgEnum('workspace_invite_status', [
  'pending',
  'accepted',
  'revoked',
]);
export const ingestStatusEnum = pgEnum('ingest_status', [
  'pending',
  'running',
  'completed',
  'failed',
]);
export const connectionKindEnum = pgEnum('connection_kind', ['notion-composio', 'notion-zip']);
export const connectionStatusEnum = pgEnum('connection_status', [
  'pending_import',
  'active',
  'paused',
  'completed',
  'errored',
  'disconnected',
]);
export const ingestModeEnum = pgEnum('ingest_mode', ['import_once', 'periodic_pull']);
export const llmProviderEnum = pgEnum('llm_provider', ['openai', 'anthropic']);
export const llmScopeEnum = pgEnum('llm_scope', ['chat', 'embed']);
export const billingUsageStatusEnum = pgEnum('billing_usage_status', [
  'included',
  'metered',
  'unreported',
  'failed',
  'ignored',
]);
export const skillRevisionRoleEnum = pgEnum('skill_revision_role', ['you', 'brain']);

// =====================================================================
// users
// =====================================================================

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  supabaseUserId: text('supabase_user_id').unique(),
  email: text('email').notNull().unique(),
  // NOTE: current_workspace_id is a UI hint and is NEVER trusted for authorization.
  // Every tenant-scoped route reads workspace_id from the request and gates with
  // requireMembership / assertWorkspaceMembership. See docs/superpowers/specs/2026-05-11-workspace-invite-flow-design.md.
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
    name: text('name').notNull().default('Untitled workspace'),
    plan: workspacePlanEnum('plan'),
    billingPlanKey: text('billing_plan_key').notNull().default('basic'),
    billingMode: workspaceBillingModeEnum('billing_mode').notNull().default('platform'),
    stripeCustomerId: text('stripe_customer_id'),
    stripeSubscriptionId: text('stripe_subscription_id'),
    stripeSubscriptionStatus: text('stripe_subscription_status'),
    stripeSubscriptionCurrentPeriodStart: timestamp('stripe_subscription_current_period_start', {
      withTimezone: true,
    }),
    stripeSubscriptionCurrentPeriodEnd: timestamp('stripe_subscription_current_period_end', {
      withTimezone: true,
    }),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    flyMachineId: text('fly_machine_id'),
    flyPrivateIp: text('fly_private_ip'),
    gbrainBaseUrl: text('gbrain_base_url'),
    gbrainOauthClientId: text('gbrain_oauth_client_id'),
    // AES-GCM(client_secret, OPEN42_KEK). Plaintext NEVER stored.
    gbrainOauthClientSecretCiphertext: bytea('gbrain_oauth_client_secret_ciphertext'),
    proxyTokenHash: bytea('proxy_token_hash'),
    gbrainVersion: text('gbrain_version').notNull(),
    status: workspaceStatusEnum('status').notNull().default('provisioning'),
    lastError: text('last_error'),
    provisionAttempts: integer('provision_attempts').notNull().default(0),
    provisioningStartedAt: timestamp('provisioning_started_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
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
    stripeCustomerUniq: uniqueIndex('workspaces_stripe_customer_id_uniq')
      .on(t.stripeCustomerId)
      .where(sql`${t.stripeCustomerId} IS NOT NULL`),
    stripeSubscriptionUniq: uniqueIndex('workspaces_stripe_subscription_id_uniq')
      .on(t.stripeSubscriptionId)
      .where(sql`${t.stripeSubscriptionId} IS NOT NULL`),
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
// workspace_invites (captured during Slack-shaped onboarding)
// =====================================================================

export const workspaceInvites = pgTable(
  'workspace_invites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    invitedByUserId: uuid('invited_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: membershipRoleEnum('role').notNull().default('member'),
    status: workspaceInviteStatusEnum('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    workspaceIdx: index('workspace_invites_workspace_idx').on(t.workspaceId),
    pendingEmailUniq: uniqueIndex('workspace_invites_pending_email_uniq')
      .on(t.workspaceId, t.email)
      .where(sql`${t.status} = 'pending'`),
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
    /**
     * Which skill this export came from.
     */
    skillId: uuid('skill_id').references(() => skills.id, {
      onDelete: 'set null',
    }),
    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
    citationsCount: integer('citations_count').notNull(),
    /**
     * Slugs of the gbrain documents this export cited. Drives the Library
     * "Cited in skills" smart collection. Existing rows backfill to `[]`.
     */
    citedDocSlugs: jsonb('cited_doc_slugs')
      .notNull()
      .default(sql`'[]'::jsonb`),
    sourcePagesOldestAt: timestamp('source_pages_oldest_at', { withTimezone: true }),
    stalenessWarning: boolean('staleness_warning').notNull().default(false),
  },
  (t) => ({
    workspaceIdx: index('skill_exports_workspace_idx').on(t.workspaceId),
    generatedIdx: index('skill_exports_generated_idx').on(t.generatedAt),
    skillIdx: index('skill_exports_skill_idx').on(t.skillId),
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
    connectorsSummary: jsonb('connectors_summary')
      .notNull()
      .default(sql`'[]'::jsonb`),
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
    cursor: jsonb('cursor')
      .notNull()
      .default(sql`'{}'::jsonb`),
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
      .where(sql`${t.kind} IN ('notion-composio', 'notion-zip') AND ${t.status} <> 'disconnected'`),
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
// mcp_audit_log (per-tenant audit trail of every gbrain MCP tool call)
// Stores STRUCTURAL metadata only — no request/response body content.
// `request_hmac` is an HMAC-SHA256 fingerprint over the raw arguments
// (rotatable, no plaintext recovery). See Codex review #6.
// =====================================================================

export const mcpAuditLog = pgTable(
  'mcp_audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    callerUserId: uuid('caller_user_id').references(() => users.id, { onDelete: 'set null' }),
    toolName: text('tool_name').notNull(),
    requestHmac: bytea('request_hmac').notNull(),
    requestId: text('request_id').notNull(),
    status: integer('status').notNull(),
    durationMs: integer('duration_ms').notNull(),
    resultCount: integer('result_count'),
    errorCode: text('error_code'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    workspaceCreatedIdx: index('mcp_audit_workspace_created_idx').on(t.workspaceId, t.createdAt),
  }),
);

// =====================================================================
// skills, skill_versions, skill_revisions (wide Skillify — workspace-
// scoped, user-mintable skills with versioned bodies and a chat-style
// revision log).
//
// `skills` is the per-workspace identity; `skill_versions` stores each
// committed body + frontmatter (immutable, append-only); `skill_revisions`
// is the chat log between user and brain that produced (or is in-flight
// toward) a version. The existing `skill_exports` audit trail and the
// `skill_type` enum stay untouched for the legacy refund-policy export
// path until the wide-Skillify generator lands and migrates the data.
// =====================================================================

export const skills = pgTable(
  'skills',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /** kebab-case slug; unique per workspace. Maps to SKILL.md frontmatter `name`. */
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    workspaceNameUniq: uniqueIndex('skills_workspace_name_uniq').on(t.workspaceId, t.name),
  }),
);

export const skillVersions = pgTable(
  'skill_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    skillId: uuid('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),
    /** Semver string, e.g. "0.1.2". Unique per skill. */
    version: text('version').notNull(),
    /** Parsed YAML frontmatter — name, description, triggers, tools, etc. */
    frontmatter: jsonb('frontmatter').notNull(),
    /** SKILL.md markdown body (everything after the frontmatter). */
    body: text('body').notNull(),
    /** Slugs of gbrain docs cited in this version. Mirrors `skill_exports.cited_doc_slugs`. */
    citedDocSlugs: jsonb('cited_doc_slugs')
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    skillCreatedIdx: index('skill_versions_skill_created_idx').on(t.skillId, t.createdAt),
    skillVersionUniq: uniqueIndex('skill_versions_skill_version_uniq').on(t.skillId, t.version),
  }),
);

export const skillRevisions = pgTable(
  'skill_revisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    skillId: uuid('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),
    /**
     * The version this revision contributed to, or NULL while still in
     * flight. Set when the revision lands in a committed version.
     */
    versionId: uuid('version_id').references(() => skillVersions.id, {
      onDelete: 'set null',
    }),
    role: skillRevisionRoleEnum('role').notNull(),
    text: text('text').notNull(),
    /** Inline cite chip text, e.g. "[1] [2]". Optional. */
    cites: text('cites'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    skillCreatedIdx: index('skill_revisions_skill_created_idx').on(t.skillId, t.createdAt),
  }),
);

// =====================================================================
// document_citations (workspace-scoped log of which gbrain doc was cited
// in which assistant turn). Drives the Library "Most cited" smart
// collection and the per-doc citationCount the cards render.
//
// One row per (assistant turn, doc slug). When a single answer cites the
// same slug across multiple chunks, we still write only one row — most-
// cited reflects "asks where this doc was cited at least once". Adding
// userId / askId fields later is additive.
// =====================================================================

export const documentCitations = pgTable(
  'document_citations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    docSlug: text('doc_slug').notNull(),
    citedAt: timestamp('cited_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    workspaceSlugIdx: index('document_citations_workspace_slug_idx').on(t.workspaceId, t.docSlug),
    workspaceCitedAtIdx: index('document_citations_workspace_cited_at_idx').on(
      t.workspaceId,
      t.citedAt,
    ),
  }),
);

// =====================================================================
// workspace_credentials (per-workspace BYOK keys for LLM providers)
// One row per (workspace, provider, scope). UI re-saves do an UPSERT.
// `secret_ciphertext` is AES-GCM-sealed via envelope.encryptSecret with
// `purpose: 'workspace_credential'`. Plaintext NEVER stored.
// =====================================================================

export const workspaceCredentials = pgTable(
  'workspace_credentials',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    provider: llmProviderEnum('provider').notNull(),
    scope: llmScopeEnum('scope').notNull(),
    secretCiphertext: bytea('secret_ciphertext').notNull(),
    // Optional model override (e.g. 'claude-haiku-4-5'). The resolver returns
    // this so callers don't need a second lookup.
    model: text('model'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // One credential per (workspace, provider, scope). Re-saving from the UI
    // does an UPDATE, not an INSERT.
    workspaceProviderScopeUniq: uniqueIndex('workspace_credentials_uniq').on(
      t.workspaceId,
      t.provider,
      t.scope,
    ),
  }),
);

// =====================================================================
// billing_usage_events (per-workspace shared-key request ledger)
// Counts LLM/embedding requests that used Open42's shared provider keys.
// BYOK calls are intentionally ignored for overage billing because the
// upstream provider bills the customer's own account directly.
// =====================================================================

export const billingUsageEvents = pgTable(
  'billing_usage_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    provider: llmProviderEnum('provider').notNull(),
    scope: llmScopeEnum('scope').notNull(),
    keySource: text('key_source').notNull(),
    units: integer('units').notNull().default(1),
    includedUnits: integer('included_units').notNull().default(0),
    billableUnits: integer('billable_units').notNull().default(0),
    status: billingUsageStatusEnum('status').notNull(),
    stripeCustomerId: text('stripe_customer_id'),
    stripeMeterEventName: text('stripe_meter_event_name'),
    stripeMeterEventIdentifier: text('stripe_meter_event_identifier'),
    error: text('error'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    workspaceOccurredIdx: index('billing_usage_events_workspace_occurred_idx').on(
      t.workspaceId,
      t.occurredAt,
    ),
    workspaceStatusIdx: index('billing_usage_events_workspace_status_idx').on(
      t.workspaceId,
      t.status,
    ),
    stripeMeterIdentifierUniq: uniqueIndex('billing_usage_events_stripe_meter_identifier_uniq')
      .on(t.stripeMeterEventIdentifier)
      .where(sql`${t.stripeMeterEventIdentifier} IS NOT NULL`),
    unitsCheck: check('billing_usage_events_units_positive', sql`${t.units} > 0`),
    includedUnitsCheck: check(
      'billing_usage_events_included_units_nonnegative',
      sql`${t.includedUnits} >= 0`,
    ),
    billableUnitsCheck: check(
      'billing_usage_events_billable_units_nonnegative',
      sql`${t.billableUnits} >= 0`,
    ),
    keySourceCheck: check(
      'billing_usage_events_key_source_check',
      sql`${t.keySource} IN ('tenant', 'shared')`,
    ),
  }),
);

// =====================================================================
// stripe_webhook_events
// Idempotency ledger for Stripe webhook delivery. Stripe retries and may
// deliver duplicates; this table lets the webhook route claim, complete, and
// safely ignore already-processed events.
// =====================================================================

export const stripeWebhookEvents = pgTable(
  'stripe_webhook_events',
  {
    id: text('id').primaryKey(),
    type: text('type').notNull(),
    processingStartedAt: timestamp('processing_started_at', { withTimezone: true }),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    processedAtIdx: index('stripe_webhook_events_processed_at_idx').on(t.processedAt),
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
export type WorkspaceInvite = typeof workspaceInvites.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type SkillExport = typeof skillExports.$inferSelect;
export type IngestJob = typeof ingestJobs.$inferSelect;
export type DocumentCitation = typeof documentCitations.$inferSelect;
export type NewDocumentCitation = typeof documentCitations.$inferInsert;
export type Skill = typeof skills.$inferSelect;
export type NewSkill = typeof skills.$inferInsert;
export type SkillVersion = typeof skillVersions.$inferSelect;
export type NewSkillVersion = typeof skillVersions.$inferInsert;
export type SkillRevision = typeof skillRevisions.$inferSelect;
export type NewSkillRevision = typeof skillRevisions.$inferInsert;
export type StripeWebhookEvent = typeof stripeWebhookEvents.$inferSelect;
export type Connection = typeof connections.$inferSelect;
export type NewConnection = typeof connections.$inferInsert;
export type ConnectionInitState = typeof connectionInitStates.$inferSelect;
export type NewConnectionInitState = typeof connectionInitStates.$inferInsert;
export type McpAuditLog = typeof mcpAuditLog.$inferSelect;
export type NewMcpAuditLog = typeof mcpAuditLog.$inferInsert;
export type WorkspaceCredential = typeof workspaceCredentials.$inferSelect;
export type NewWorkspaceCredential = typeof workspaceCredentials.$inferInsert;
export type BillingUsageEvent = typeof billingUsageEvents.$inferSelect;
export type NewBillingUsageEvent = typeof billingUsageEvents.$inferInsert;
