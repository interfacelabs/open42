import { create } from 'zustand';

import type { ShareLinkResult, SkillSummary } from '@open42/shared-types';

interface SkillsState {
  byWorkspace: Record<string, SkillSummary[]>;
  shareLinks: Record<string, ShareLinkResult>;
  setSkills: (workspaceId: string, skills: SkillSummary[]) => void;
  cacheShareLink: (skillId: string, link: ShareLinkResult) => void;
  shareLinkRemainingMs: (skillId: string, now?: number) => number | null;
}

export const useSkillsStore = create<SkillsState>((set, get) => ({
  byWorkspace: {},
  shareLinks: {},
  setSkills: (workspaceId, skills) =>
    set((state) => ({ byWorkspace: { ...state.byWorkspace, [workspaceId]: skills } })),
  cacheShareLink: (skillId, link) =>
    set((state) => ({ shareLinks: { ...state.shareLinks, [skillId]: link } })),
  shareLinkRemainingMs: (skillId, now = Date.now()) => {
    const link = get().shareLinks[skillId];
    if (!link) return null;
    return Math.max(0, new Date(link.expiresAt).getTime() - now);
  },
}));
