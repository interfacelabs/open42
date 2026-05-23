import Link from 'next/link';
import { NAV_LINKS, OPEN42_REPO_URL } from '@/lib/content';
import { Wordmark } from '@/components/Wordmark';

export function SiteNav() {
  return (
    <nav className="relative z-30 bg-page">
      <div className="page-frame mx-auto w-full max-w-[1320px] px-4 sm:px-6">
        <div className="flex h-[77px] items-center justify-between">
          <Wordmark />

          <ul className="hidden items-center gap-10 md:flex">
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="font-mono text-[14px] text-ink-soft transition-colors hover:text-ink"
                >
                  {link.label}
                </Link>
              </li>
            ))}
            <li>
              <Link
                href={OPEN42_REPO_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 font-mono text-[14px] text-ink-soft transition-colors hover:text-ink"
              >
                <span>GitHub</span>
                <span className="rounded-full border border-line bg-surface px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-ink">
                  Source
                </span>
              </Link>
            </li>
          </ul>

          <Link
            href="#open-demo"
            className="inline-flex h-[35px] items-center rounded-lg bg-ink px-4 font-mono text-[14px] text-white transition-opacity hover:opacity-90"
          >
            Open demo
          </Link>
        </div>
      </div>
    </nav>
  );
}
