import Link from "next/link";
import { NAV_LINKS } from "@/lib/content";
import { Wordmark } from "@/components/Wordmark";
import { ComingSoonLink } from "@/components/ComingSoonLink";

export function SiteNav() {
  return (
    <nav className="relative z-30 bg-page">
      <div className="page-frame mx-auto w-full max-w-[1320px] px-6">
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
              <ComingSoonLink className="font-mono text-[14px] text-ink-soft transition-colors hover:text-ink">
                GitHub
              </ComingSoonLink>
            </li>
          </ul>

          <Link
            href="/sign_in"
            className="inline-flex h-[35px] items-center rounded-lg bg-ink px-4 font-mono text-[14px] text-white transition-opacity hover:opacity-90"
          >
            Start free
          </Link>
        </div>
      </div>
    </nav>
  );
}
