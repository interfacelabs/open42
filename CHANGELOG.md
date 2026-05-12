# Changelog

All notable changes to Open42 are documented here.

## Unreleased

### Added
- Workspace invite flow (Settings → Members): invite by email, list pending invites, resend, revoke, manage member roles, kick members.
- Multi-workspace memberships: a user can own and join arbitrarily many workspaces. Top-of-sidebar workspace switcher.
- In-app workspace creation: `/auth/onboard?mode=create`.
- New `admin` role on memberships (alongside `owner` and `member`).
- `GET /auth/me` returning the current session user (id, email, current_workspace_id).
- `POST /workspaces` (in-app create), `GET /workspaces` (list user's workspaces), `POST /workspaces/:id/switch`.
- `POST /workspaces/invites/:inviteId/accept` (signed-in fast path; one-click accept when the invitee is already logged in).

### Changed
- **BREAKING (API):** Connections routes moved from `/connections/*` to `/workspaces/:id/connections/*`. Web proxy paths follow the same move.

  | Before | After |
  |---|---|
  | `GET /connections` | `GET /workspaces/:id/connections` |
  | `DELETE /connections/:connectionId` | `DELETE /workspaces/:id/connections/:connectionId` |
  | `POST /connections/notion-zip/upload` | `POST /workspaces/:id/connections/notion-zip/upload` |
  | `POST /connections/composio/init` | `POST /workspaces/:id/connections/composio/init` |
  | `POST /connections/composio/finalize` | `POST /workspaces/:id/connections/composio/finalize` |

- **BREAKING (API):** Library, skills, and BYOK credentials routes moved off the non-deterministic "first owned workspace" lookup (`resolveOwnerWorkspaceId` with `LIMIT 1`, undefined ordering — broken under multi-workspace ownership) onto explicit `/workspaces/:id/...` mounts gated by `requireMembership({ from: 'param' })`. Web proxies and consumers thread the current workspace id from the Zustand store.

  | Before | After |
  |---|---|
  | `GET /library` | `GET /workspaces/:id/library` |
  | `GET /library/doc/:id` | `GET /workspaces/:id/library/doc/:docId` |
  | `GET /skills` | `GET /workspaces/:id/skills` |
  | `POST /skills` | `POST /workspaces/:id/skills` |
  | `POST /skills/:id` | `POST /workspaces/:id/skills/:skillId` |
  | `GET /skills/:id/draft` | `GET /workspaces/:id/skills/:skillId/draft` |
  | `POST /skills/:id/revise` | `POST /workspaces/:id/skills/:skillId/revise` |
  | `GET /workspaces/credentials` | `GET /workspaces/:id/credentials` |
  | `POST /workspaces/credentials` | `POST /workspaces/:id/credentials` |
  | `DELETE /workspaces/credentials` | `DELETE /workspaces/:id/credentials` |

- `POST /chat` now requires `workspace_id` in the body. The workspace is no longer inferred from `users.current_workspace_id`.
- `users.current_workspace_id` is now documented as a UI hint only. Authorization always flows through `requireMembership`.
- `/auth/verify` no longer rejects invite acceptance for users who already own a workspace (multi-workspace ownership is now supported).
- BullMQ provision jobs are now keyed by `workspaceId` (was `ownerUserId`), so a user can create multiple workspaces within the 24h job-retention window without the second create being silently no-op'd.

### Security
- Closed cross-tenant access gap on chat / connections / ingest. Every tenant-scoped route is gated by `requireMembership`.
- Invite-accept membership insert is now idempotent (`ON CONFLICT DO NOTHING`), so a duplicate (e.g., admin manually added the user mid-flight) no longer 500s.
- Workspace invite `state_path_workspace_mismatch` check on the Composio finalize path prevents replay of a valid HMAC state against a different workspace.
