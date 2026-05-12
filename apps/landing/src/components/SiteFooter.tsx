import Link from "next/link";
import { FOOTER } from "@/lib/content";
import { Wordmark } from "@/components/Wordmark";
import { XSocial, LinkedInIcon } from "@/components/icons";
import { ComingSoonLink } from "@/components/ComingSoonLink";

const OPEN42_REPO_URL = "https://github.com/interfacelabs/open42";

export function SiteFooter() {
  return (
    <footer className="bg-page">
      <div className="page-frame mx-auto w-full max-w-[1320px] px-6 pt-16 pb-10">
        <div className="grid grid-cols-1 gap-12 md:grid-cols-[1.2fr_1fr_1fr_1fr]">
          <div>
            <Wordmark size="lg" />
            <p className="mt-6 max-w-[360px] font-mono text-[14px] leading-[22px] text-muted-ink">
              {FOOTER.tagline}
            </p>
            <div className="mt-6 flex items-center gap-4 text-ink">
              <ComingSoonLink
                ariaLabel="GitHub"
                className="font-mono text-[13px] text-ink-soft transition-opacity hover:opacity-70"
              >
                GitHub
              </ComingSoonLink>
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
                      <ComingSoonLink className="font-mono text-[14px] text-ink transition-opacity hover:opacity-70">
                        {link.label}
                      </ComingSoonLink>
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
          <p className="font-mono text-[12px] text-muted-ink">
            {FOOTER.copyright}
          </p>
          <div className="flex items-center gap-2 font-mono text-[12px] text-muted-ink">
            <span className="inline-block h-2 w-2 rounded-full bg-positive" />
            {FOOTER.status}
          </div>
        </div>
      </div>
    </footer>
  );
}
