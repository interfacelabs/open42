import { create } from 'zustand';

import type { UserSummary, WorkspaceCurrentPayload, WorkspaceSummary } from '@open42/shared-types';

import { ApiError, apiFetch, clearCookieJar } from '@/utils/api';

interface AuthState {
  hydrated: boolean;
  restoring: boolean;
  user: UserSummary | null;
  workspaces: WorkspaceSummary[];
  current: WorkspaceCurrentPayload | null;
  currentWorkspaceId: string | null;
  restoreSession: () => Promise<void>;
  refreshCurrent: () => Promise<WorkspaceCurrentPayload | null>;
  refreshWorkspaces: () => Promise<WorkspaceSummary[]>;
  switchWorkspace: (workspaceId: string) => Promise<void>;
  setCurrent: (payload: WorkspaceCurrentPayload | null) => void;
  signOutLocal: () => Promise<void>;
  signOutRemote: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  hydrated: false,
  restoring: false,
  user: null,
  workspaces: [],
  current: null,
  currentWorkspaceId: null,
  async restoreSession() {
    if (get().restoring) return;
    set({ restoring: true });
    try {
      const user = await apiFetch<UserSummary>('/auth/me');
      set({ user });
      await Promise.all([get().refreshCurrent(), get().refreshWorkspaces()]);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        await get().signOutLocal();
      }
    } finally {
      set({ hydrated: true, restoring: false });
    }
  },
  async refreshCurrent() {
    const current = await apiFetch<WorkspaceCurrentPayload>('/workspaces/current');
    get().setCurrent(current);
    return current;
  },
  async refreshWorkspaces() {
    const payload = await apiFetch<{ workspaces: WorkspaceSummary[] }>('/workspaces');
    set((state) => {
      const currentWorkspaceId =
        state.currentWorkspaceId ??
        state.current?.workspace?.id ??
        payload.workspaces[0]?.id ??
        null;
      return { workspaces: payload.workspaces, currentWorkspaceId };
    });
    return payload.workspaces;
  },
  async switchWorkspace(workspaceId) {
    const payload = await apiFetch<{ workspace: WorkspaceSummary }>(
      `/workspaces/${encodeURIComponent(workspaceId)}/switch`,
      { method: 'POST' }
    );
    set({ currentWorkspaceId: payload.workspace.id });
    await Promise.all([get().refreshCurrent(), get().refreshWorkspaces()]);
  },
  setCurrent(payload) {
    set((state) => ({
      current: payload,
      user: payload?.user ?? state.user,
      currentWorkspaceId: payload?.workspace?.id ?? state.currentWorkspaceId,
    }));
  },
  async signOutLocal() {
    await clearCookieJar();
    set({
      hydrated: true,
      restoring: false,
      user: null,
      workspaces: [],
      current: null,
      currentWorkspaceId: null,
    });
  },
  async signOutRemote() {
    try {
      await apiFetch('/auth/signout', { method: 'POST' });
    } finally {
      await get().signOutLocal();
    }
  },
}));
