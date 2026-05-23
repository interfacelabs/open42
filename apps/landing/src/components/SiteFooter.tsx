import Link from 'next/link';
import { FOOTER, OPEN42_REPO_URL } from '@/lib/content';
import { Wordmark } from '@/components/Wordmark';
import { XSocial, LinkedInIcon } from '@/components/icons';

export function SiteFooter() {
  return (
    <footer className="bg-page">
      <div className="page-frame mx-auto w-full max-w-[1320px] px-4 pt-14 pb-10 sm:px-6 md:pt-16">
        <div className="grid grid-cols-1 gap-12 md:grid-cols-[1.2fr_1fr_1fr_1fr]">
          <div>
            <Wordmark size="lg" />
            <p className="mt-6 max-w-[360px] font-mono text-[14px] leading-[22px] text-muted-ink">
              {FOOTER.tagline}
            </p>
            <p className="mt-4 max-w-[380px] font-mono text-[12px] leading-[20px] text-muted-ink">
              Interface Labs Ltd · 124 City Road, London, England, EC1V 2NX ·{' '}
              <Link
                href="mailto:support@open42.ai"
                className="text-ink underline-offset-4 hover:underline"
              >
                support@open42.ai
              </Link>
            </p>
            <div className="mt-6 flex items-center gap-4 text-ink">
              <Link
                href={OPEN42_REPO_URL}
                target="_blank"
                rel="noreferrer"
                aria-label="GitHub repository"
                className="inline-flex items-center gap-1.5 font-mono text-[13px] text-ink-soft transition-opacity hover:opacity-70"
              >
                <span>GitHub</span>
                <span className="rounded-full border border-line bg-surface px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-muted-ink">
                  Source
                </span>
              </Link>
              <Link
                href="#x"
                aria-label="X (Twitter)"
                className="opacity-80 transition-opacity hover:opacity-100"
              >
                <XSocial className="h-4 w-4" />
              </Link>
              <Link
                href="#linkedin"
                aria-label="LinkedIn"
                className="opacity-80 transition-opacity hover:opacity-100"
              >
                <LinkedInIcon className="h-4 w-4" />
              </Link>
            </div>
          </div>

          {FOOTER.columns.map((col) => (
            <div key={col.title}>
              <h4 className="font-mono text-[12px] uppercase tracking-wider text-muted-ink">
                {col.title}
              </h4>
              <ul className="mt-4 space-y-3">
                {col.links.map((link) => (
                  <li key={link.label}>
                    {link.href === OPEN42_REPO_URL ? (
                      <Link
                        href={link.href}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 font-mono text-[14px] text-ink transition-opacity hover:opacity-70"
                      >
                        <span>{link.label}</span>
                        <span className="rounded-full border border-line bg-surface px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-muted-ink">
                          Source
                        </span>
                      </Link>
                    ) : (
                      <Link
                        href={link.href}
                        className="font-mono text-[14px] text-ink transition-opacity hover:opacity-70"
                      >
                        {link.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-16 flex flex-col items-start justify-between gap-3 border-t border-line pt-6 md:flex-row md:items-center">
          <p className="font-mono text-[12px] text-muted-ink">{FOOTER.copyright}</p>
          <div className="flex items-center gap-2 font-mono text-[12px] text-muted-ink">
            <span className="inline-block h-2 w-2 rounded-full bg-positive" />
            {FOOTER.status}
          </div>
        </div>
      </div>
    </footer>
  );
}
