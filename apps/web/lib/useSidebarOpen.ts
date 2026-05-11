import { create } from 'zustand';

interface SidebarState {
  open: boolean;
  setOpen: (value: boolean) => void;
  toggle: () => void;
}

/**
 * Sidebar drawer state for narrow viewports.
 *
 * On md+ the sidebar is always visible and this flag is ignored. Below md the
 * sidebar lives in a fixed-position drawer that slides in when `open` is true.
 */
export const useSidebarOpen = create<SidebarState>((set) => ({
  open: false,
  setOpen: (value) => set({ open: value }),
  toggle: () => set((state) => ({ open: !state.open })),
}));
