import { PanelRightOpen } from 'lucide-react';

import { useUtilityPanelVisible } from '@/lib/useUtilityPanelVisible';

/**
 * Floating chevron that re-opens the dismissed UtilityPanel.
 *
 * Renders nothing when the panel is visible. Anchored to the right edge of
 * the viewport so it works regardless of the host page's layout. Mounted by
 * <AppShell /> on routes that use the utility rail.
 */
export function UtilityPanelToggle() {
  const { visible, setVisible } = useUtilityPanelVisible();
  if (visible) return null;
  return (
    <button
      type="button"
      onClick={() => setVisible(true)}
      aria-label="Show workspace panel"
      title="Show workspace panel"
      className="fixed right-3 top-7 z-30 hidden h-8 w-8 items-center justify-center rounded-md border border-border-soft bg-white text-text-subtle shadow-card transition-colors duration-140 hover:border-blue-line hover:text-text-primary lg:flex"
    >
      <PanelRightOpen size={14} strokeWidth={1.6} />
    </button>
  );
}
