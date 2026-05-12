import Link from 'next/link';

import { cn } from '@/lib/utils';

export type SettingsTab = 'connections' | 'ingest' | 'api-keys' | 'plan';

const TABS: Array<{ id: SettingsTab; label: string; href: string }> = [
  { id: 'connections', label: 'Connections', href: '/settings/connections' },
  { id: 'ingest', label: 'Ingest', href: '/settings/ingest' },
  { id: 'api-keys', label: 'API keys', href: '/settings/api-keys' },
  { id: 'plan', label: 'Billing', href: '/settings/plan' },
];

/**
 * Horizontal sub-navigation for the /settings/* surfaces. Rendered
 * directly below <PageHeader /> so each settings page exposes its peers.
 */
export function SettingsNav({ active }: { active: SettingsTab }) {
  return (
    <nav
      aria-label="Settings"
      className="overflow-x-auto border-b border-border-soft bg-background px-5 md:px-10"
    >
      <ul className="flex gap-1 whitespace-nowrap">
        {TABS.map((tab) => {
          const isActive = tab.id === active;
          return (
            <li key={tab.id}>
              <Link
                href={tab.href}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  '-mb-px inline-flex h-10 items-center border-b-2 px-3 text-[13px] font-medium transition-colors duration-140',
                  isActive
                    ? 'border-blue text-text-primary'
                    : 'border-transparent text-text-subtle hover:text-text-primary',
                )}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
