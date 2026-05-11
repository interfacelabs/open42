import { Menu } from 'lucide-react';

import { useSidebarOpen } from '@/lib/useSidebarOpen';
import { cn } from '@/lib/utils';

/**
 * Hamburger that opens the sidebar drawer on small screens. Hidden on md+
 * where the sidebar is always visible. Render at the start of a page's top
 * bar (before the breadcrumb/title).
 */
export function MobileNavTrigger({ className }: { className?: string }) {
  const toggle = useSidebarOpen((s) => s.toggle);
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Open navigation"
      className={cn(
        'flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border-soft bg-white text-text-body transition-colors duration-140 hover:border-blue-line hover:text-text-primary md:hidden',
        className,
      )}
    >
      <Menu size={16} strokeWidth={1.6} />
    </button>
  );
}
