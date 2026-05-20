import Link from 'next/link';
import { CTA } from '@/lib/content';
import { DemoSignupCta } from '@/components/DemoSignupCta';

export function CtaSection() {
  return (
    <section className="relative bg-page">
      <div className="page-frame mx-auto w-full max-w-[1320px] px-6 py-16">
        <div className="relative overflow-hidden rounded-3xl bg-[#0a0a0a] px-8 py-24 text-center md:py-32">
          {/* Subtle gradient sheen. */}
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_30%,rgba(255,255,255,0.06),transparent_60%)]" />

          {/* Diagonal stripes hint. */}
          <div className="diag-stripes pointer-events-none absolute inset-x-0 top-0 h-20 opacity-[0.18]" />

          {/* Floating receipt tokens — atmospheric. */}
          <ReceiptTokens />

          <div className="relative z-10 mx-auto max-w-[800px]">
            <h2 className="font-sans text-[40px] font-medium leading-[1.0] tracking-[-0.03em] text-white md:text-[64px] md:leading-[0.98]">
              {CTA.heading}
            </h2>
            <p className="mx-auto mt-6 max-w-[640px] font-mono text-[15px] leading-[24px] text-white/70">
              {CTA.subhead}
            </p>

            <div className="mx-auto mt-8 max-w-[620px] text-left">
              <DemoSignupCta variant="dark" />
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
              <Link
                href={CTA.secondary.href}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-[42px] items-center gap-2 rounded-lg bg-[#1f1f1f] px-4 font-mono text-[14px] text-white transition-opacity hover:opacity-90"
              >
                <span>{CTA.secondary.label}</span>
                <span className="rounded-full border border-white/10 bg-white/[0.06] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-white/60">
                  Source
                </span>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function ReceiptTokens() {
  const tokens = [
    { label: '[1] refund-policy.md', left: '8%', top: '22%' },
    { label: '[2] sales-exceptions.md', left: '72%', top: '18%' },
    { label: 'Save as Skill →', left: '12%', top: '70%' },
    { label: 'version 14', left: '78%', top: '72%' },
  ];
  return (
    <div className="pointer-events-none absolute inset-0">
      {tokens.map((t) => (
        <span
          key={t.label}
          className="absolute inline-flex items-center rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 font-mono text-[11px] text-white/40 backdrop-blur-sm"
          style={{ left: t.left, top: t.top }}
        >
          {t.label}
        </span>
      ))}
    </div>
  );
}
