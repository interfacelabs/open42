import { useEffect } from 'react';
import useSWR from 'swr';

import type {
  McpProxyStatus,
  SkillSummary,
  WorkspaceCurrentPayload,
  WorkspaceSummary,
} from '@open42/shared-types';

import { useAuthStore } from '@/store/auth';
import { useSkillsStore } from '@/store/skills';
import { apiFetcher } from '@/utils/api';

export function useCurrentWorkspace() {
  const setCurrent = useAuthStore((state) => state.setCurrent);
  const swr = useSWR<WorkspaceCurrentPayload>('/workspaces/current', apiFetcher, {
    refreshInterval: (latest) => (latest?.workspace?.runtime === 'provisioning' ? 1500 : 0),
  });

  useEffect(() => {
    if (swr.data) setCurrent(swr.data);
  }, [setCurrent, swr.data]);

  return swr;
}

export function useWorkspaces() {
  const swr = useSWR<{ workspaces: WorkspaceSummary[] }>('/workspaces', apiFetcher);
  const workspaces = swr.data?.workspaces ?? [];
  return { ...swr, workspaces };
}

export function useSkills(workspaceId: string | null) {
  const setSkills = useSkillsStore((state) => state.setSkills);
  const swr = useSWR<{ skills: SkillSummary[] }>(
    workspaceId ? `/workspaces/${encodeURIComponent(workspaceId)}/skills` : null,
    apiFetcher
  );

  useEffect(() => {
    if (workspaceId && swr.data?.skills) setSkills(workspaceId, swr.data.skills);
  }, [setSkills, swr.data?.skills, workspaceId]);

  return { ...swr, skills: swr.data?.skills ?? [] };
}

export function useMcpProxy(workspaceId: string | null) {
  return useSWR<McpProxyStatus>(
    workspaceId ? `/workspaces/${encodeURIComponent(workspaceId)}/mcp-proxy` : null,
    apiFetcher
  );
}
