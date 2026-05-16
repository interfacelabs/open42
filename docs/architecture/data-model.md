# Data Model

Open42 uses Drizzle with Postgres for product metadata. The core schema is in
`apps/api/src/db/schema.ts`; cloud-only billing tables are in
`packages/cloud/api/schema-cloud.ts`.

## Core Tables

| Table                             | Purpose                                                                                                 |
| --------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `users`                           | Application users mapped to Supabase identities.                                                        |
| `workspaces`                      | Tenant metadata, provisioning status, gbrain endpoints, encrypted OAuth client secret, ingest schedule. |
| `memberships`                     | Workspace authorization claim; every tenant-scoped route gates through this table.                      |
| `workspace_invites`               | Pending, accepted, and revoked invites.                                                                 |
| `sessions`                        | Server-side sessions; cookie stores only the session id.                                                |
| `connections`                     | Workspace data sources such as Notion zip and Notion via Composio.                                      |
| `connection_init_states`          | OAuth state scratchpad for connector setup.                                                             |
| `connector_auth_profiles`         | Workspace-scoped Composio isolation profiles; BYOK profiles store encrypted API keys.                   |
| `connector_auth_profile_services` | Per-profile service auth config IDs, encrypted per workspace.                                           |
| `ingest_jobs`                     | Open42-side ingest cycle and gbrain import job status.                                                  |
| `mcp_audit_log`                   | Structural audit trail for gbrain MCP calls.                                                            |
| `document_citations`              | Tracks which gbrain documents were cited in assistant answers.                                          |
| `workspace_credentials`           | Encrypted BYOK provider keys by workspace, provider, and scope.                                         |
| `skills`                          | Workspace-level skill identities.                                                                       |
| `skill_versions`                  | Immutable stored versions of generated `SKILL.md` content.                                              |
| `skill_revisions`                 | Revision conversation history for skills.                                                               |
| `skill_exports`                   | Export audit trail and citation metadata.                                                               |

## Cloud Tables

| Table                   | Purpose                                                                 |
| ----------------------- | ----------------------------------------------------------------------- |
| `workspace_billing`     | One billing row per workspace, with Stripe customer/subscription state. |
| `billing_usage_events`  | Usage accounting for shared-key LLM requests.                           |
| `stripe_webhook_events` | Idempotency and retry state for Stripe webhooks.                        |

## Migration Layout

Community migrations live under `apps/api/src/db/migrations`. Cloud builds
generate a bundled migration directory from community migrations plus
`packages/cloud/migrations` by running
`packages/cloud/scripts/prepare-migrations.mjs`.

Development can use `npm run db:push`. Deployments should use committed
migrations.

## Authorization Rule

`users.current_workspace_id` is a UI hint, not an authorization boundary. Route
handlers should authorize through `memberships` via `requireMembership`,
`requireRole`, or helper functions in `auth/membership.ts`.
