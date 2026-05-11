import { ReactNode } from 'react';

import { QuickSwitcher } from '@/components/QuickSwitcher';
import { Sidebar } from '@/components/Sidebar';
import { UtilityPanel } from '@/components/UtilityPanel';
import { UtilityPanelToggle } from '@/components/UtilityPanelToggle';
import { cn } from '@/lib/utils';

interface AppShellProps {
  /** Page contents. Compose with <PageHeader /> at the top for the standard top bar. */
  children: ReactNode;
  /**
   * Show the right utility rail (Brain status + Quick actions + quote).
   * Defaults to false — settings pages typically don't need it. Pass true on
   * the dashboard and library.
   */
  utility?: boolean;
  /** Hide QuickSwitcher if a page needs a different command surface. */
  hideQuickSwitcher?: boolean;
  /** Optional className applied to the inner <main> column. */
  mainClassName?: string;
}

/**
 * Standard authenticated layout: Sidebar · main column · (optional) UtilityPanel.
 *
 * Pages provide their own <PageHeader /> at the top of the main column so
 * each one can declare its breadcrumb + title + actions inline. This keeps
 * the shell uniform without forcing every page into a single prop shape.
 */
export function AppShell({
  children,
  utility = false,
  hideQuickSwitcher = false,
  mainClassName,
}: AppShellProps) {
  return (
    <main className="flex min-h-screen bg-background">
      <Sidebar />
      <div
        className={cn(
          'flex min-w-0 flex-1 flex-col overflow-hidden',
          mainClassName,
        )}
      >
        {children}
      </div>
      {utility ? (
        <>
          <UtilityPanel />
          <UtilityPanelToggle />
        </>
      ) : null}
      {hideQuickSwitcher ? null : <QuickSwitcher />}
    </main>
  );
}
