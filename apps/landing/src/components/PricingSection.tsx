import Link from "next/link";
import { PRICING } from "@/lib/content";
import { SectionEyebrow } from "@/components/SectionEyebrow";
import { CheckIcon, DollarIcon } from "@/components/icons";
import { ComingSoonLink } from "@/components/ComingSoonLink";

const OPEN42_REPO_URL = "https://github.com/interfacelabs/open42";

export function PricingSection() {
  return (
    <section id="pricing" className="relative bg-page">
      <div className="page-frame mx-auto w-full max-w-[1320px] px-6 pt-24 pb-24">
        <SectionEyebrow icon={<DollarIcon className="h-3.5 w-3.5" />}>
          {PRICING.eyebrow}
        </SectionEyebrow>

        <div className="mt-6 grid grid-cols-1 gap-x-12 gap-y-2 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <h2 className="font-sans text-[40px] font-medium leading-[1.0] tracking-[-0.025em] text-ink md:text-[56px]">
            {PRICING.heading}
          </h2>
          <p className="self-end font-mono text-[16px] leading-[24px] text-muted-ink">
            {PRICING.subhead}
          </p>
        </div>

        <div className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-3">
          {PRICING.plans.map((plan) => (
            <article
              key={plan.name}
              className={
                "flex flex-col rounded-2xl border bg-surface p-6 " +
                (plan.featured
                  ? "border-ink shadow-[0_24px_60px_-40px_rgba(31,31,31,0.4)]"
                  : "border-line")
              }
            >
              <div className="flex items-center justify-between">
                <h3 className="font-mono text-[14px] tracking-wide text-ink">
                  {plan.name}
                </h3>
                {plan.featured ? (
                  <span className="inline-flex items-center rounded-full bg-ink px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-white">
                    Most teams
                  </span>
                ) : null}
              </div>

              <div className="mt-6 flex items-end gap-1">
                <span className="font-sans text-[56px] font-medium leading-none tracking-[-0.03em] text-ink md:text-[64px]">
                  {plan.price}
                </span>
                {plan.period ? (
                  <span className="mb-2 font-mono text-[14px] text-muted-ink">
                    {plan.period}
                  </span>
                ) : null}
              </div>

              <div className="mt-6 h-px w-full bg-line" />

              <p className="mt-6 font-mono text-[14px] leading-[22px] text-muted-ink">
                {plan.description}
              </p>

              {plan.href === OPEN42_REPO_URL ? (
                <ComingSoonLink
                  className={
                    "mt-6 inline-flex h-[44px] items-center justify-center rounded-lg font-mono text-[14px] transition-opacity " +
                    (plan.featured
                      ? "bg-ink text-white hover:opacity-90"
                      : "border border-line bg-surface text-ink hover:bg-page")
                  }
                >
                  {plan.cta}
                </ComingSoonLink>
              ) : (
                <Link
                  href={plan.href}
                  className={
                    "mt-6 inline-flex h-[44px] items-center justify-center rounded-lg font-mono text-[14px] transition-opacity " +
                    (plan.featured
                      ? "bg-ink text-white hover:opacity-90"
                      : "border border-line bg-surface text-ink hover:bg-page")
                  }
                >
                  {plan.cta}
                </Link>
              )}

              <p className="mt-6 font-mono text-[12px] text-muted-ink">
                Includes:
              </p>
              <ul className="mt-3 space-y-2">
                {plan.features.map((f) => (
                  <li
                    key={f}
                    className="flex items-start gap-2 font-mono text-[14px] text-ink"
                  >
                    <CheckIcon className="mt-0.5 h-4 w-4 text-ink" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
