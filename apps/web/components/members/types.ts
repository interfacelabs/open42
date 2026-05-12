/**
 * Shared types for the members settings page and its sub-components.
 *
 * The page (`apps/web/pages/auth/settings/members.tsx`) owns all data
 * fetching (SWR) and side effects (401/403/404 handling). The components
 * in this directory receive data + onChanged callbacks via props and
 * perform their own per-row mutations against the API.
 */

export type Role = 'owner' | 'admin' | 'member';

export type WorkspaceStatus = 'provisioning' | 'ready' | 'failed';

export interface Member {
  userId: string;
  email: string;
  role: Role;
  joinedAt: string;
}

export interface Invite {
  id: string;
  email: string;
  role: 'admin' | 'member';
  status: 'pending' | 'accepted' | 'revoked';
  createdAt: string;
}
