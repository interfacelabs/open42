import Link from "next/link";
import Image from "next/image";
import { HERO, PROOF } from "@/lib/content";
import { ChevronRight, OcularLogoMark } from "@/components/icons";
import { MarkdownAnswerCard } from "@/components/MarkdownAnswerCard";

export function HeroSection() {
  return (
    <section className="relative overflow-hidden bg-page">
      <HeroBackground />

      <div className="relative page-frame mx-auto w-full max-w-[1320px] px-6 pt-[80px] pb-20">
        <div className="inline-flex items-center gap-2 rounded-md border border-line bg-surface/80 px-2.5 py-1.5 backdrop-blur-sm">
          <OcularLogoMark className="h-3.5 w-3.5 text-muted-ink" />
          <span className="font-mono text-[14px] leading-none text-muted-ink">
            {HERO.eyebrow}
          </span>
        </div>

        <h1 className="mt-6 max-w-[920px] font-sans text-[44px] font-medium leading-[1.0] tracking-[-0.035em] text-ink md:text-[72px] md:leading-[0.95]">
          {HERO.heading}
        </h1>

        <p className="mt-6 max-w-[720px] font-mono text-[15px] leading-[24px] text-muted-ink md:text-[16px]">
          {HERO.subhead}
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link
            href={HERO.primaryCta.href}
            className="inline-flex h-[40px] items-center rounded-lg bg-ink px-4 font-mono text-[14px] text-white transition-opacity hover:opacity-90"
          >
            {HERO.primaryCta.label}
          </Link>
          <Link
            href={HERO.secondaryCta.href}
            className="inline-flex h-[40px] items-center gap-1.5 rounded-lg border border-line bg-surface/80 px-4 font-mono text-[14px] text-ink backdrop-blur-sm transition-colors hover:bg-page"
          >
            {HERO.secondaryCta.label}
            <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        <div className="relative mt-16 md:mt-20">
          <MarkdownAnswerCard />
        </div>

        <ul className="relative mt-20 grid grid-cols-1 gap-6 md:grid-cols-3">
          {PROOF.map((item) => (
            <li
              key={item.label}
              className="flex flex-col gap-1 border-t border-line pt-4"
            >
              <span className="font-mono text-[12px] uppercase tracking-wider text-muted-ink">
                {item.label}
              </span>
              <span className="font-sans text-[16px] leading-[22px] text-ink">
                {item.value}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function HeroBackground() {
  // Contained, lifted accent: a floating 1320px-max box, fully rounded,
  // anchored above the proof strip so the 3-column text sits on plain
  // page-white. Lower opacity and both-edge fades keep the wave detail soft.
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute left-1/2 bottom-[180px] z-0 h-[44%] w-[min(1320px,calc(100%-48px))] -translate-x-1/2 overflow-hidden rounded-[40px]"
    >
      <Image
        src="/hero/hero-bg.png"
        alt=""
        fill
        priority
        sizes="(min-width: 1320px) 1320px, 100vw"
        className="object-cover object-bottom opacity-50"
      />
      <div className="absolute inset-x-0 top-0 h-1/3 bg-gradient-to-b from-page to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-page to-transparent" />
    </div>
  );
}
