import { ReactNode } from 'react';

import { MobileNavTrigger } from '@/components/MobileNavTrigger';
import { cn } from '@/lib/utils';

interface PageHeaderProps {
  /** Mono uppercase trail, e.g. "SETTINGS · API KEYS". */
  breadcrumb?: string;
  /** Main h1 title. Plain string in most cases; ReactNode for editorial accents. */
  title: ReactNode;
  /** Optional body sub-title under the title. */
  subtitle?: ReactNode;
  /** Right-aligned actions slot. */
  actions?: ReactNode;
  /**
   * Sticky header. Defaults false. Most pages don't need it; long settings
   * forms may opt in.
   */
  sticky?: boolean;
  /** Visual size of the title. `lg` for hero pages (status), default for settings. */
  size?: 'default' | 'lg';
  className?: string;
}

/**
 * Open42 standard page header. Editorial: mono breadcrumb above, then title,
 * with right-aligned actions. Sits inside <AppShell> children.
 *
 * On mobile a leading hamburger trigger is rendered automatically to open the
 * sidebar drawer.
 */
export function PageHeader({
  breadcrumb,
  title,
  subtitle,
  actions,
  sticky = false,
  size = 'default',
  className,
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        'flex items-start justify-between gap-4 border-b border-border-soft bg-background px-5 pb-5 pt-5 md:gap-6 md:px-10 md:pt-7',
        sticky && 'sticky top-0 z-10',
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <MobileNavTrigger className="mt-0.5 md:hidden" />
        <div className="min-w-0 flex-1">
          {breadcrumb ? (
            <p className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-text-faint">
              {breadcrumb}
            </p>
          ) : null}
          <h1
            className={cn(
              'mt-1.5 font-medium leading-tight tracking-tight text-text-primary md:mt-2',
              size === 'lg'
                ? 'text-[22px] md:text-[32px]'
                : 'text-[20px] md:text-[26px]',
            )}
          >
            {title}
          </h1>
          {subtitle ? (
            <p className="mt-2 max-w-[64ch] text-[13px] leading-body text-text-subtle md:text-[13.5px]">
              {subtitle}
            </p>
          ) : null}
        </div>
      </div>
      {actions ? (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      ) : null}
    </header>
  );
}
