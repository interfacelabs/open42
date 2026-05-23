import { PROCESS } from '@/lib/content';
import { SectionEyebrow } from '@/components/SectionEyebrow';
import { CommandIcon, LinkChain, CheckIcon, RocketIcon, ChevronRight } from '@/components/icons';

const STEP_ICONS = [LinkChain, CheckIcon, RocketIcon];

export function HowItWorks() {
  return (
    <section id="how" className="relative bg-page">
      <div className="page-frame mx-auto w-full max-w-[1320px] px-4 pt-16 pb-16 sm:px-6 md:pt-24 md:pb-24">
        <SectionEyebrow icon={<CommandIcon className="h-3.5 w-3.5" />}>
          {PROCESS.eyebrow}
        </SectionEyebrow>

        <h2 className="mt-6 max-w-[760px] font-sans text-[34px] font-medium leading-[1.0] text-ink md:text-[56px] md:tracking-[-0.025em]">
          {PROCESS.heading}
        </h2>

        <div className="mt-10 grid grid-cols-1 gap-10 md:mt-16 md:gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
          {/* Left: steps. */}
          <ul className="space-y-8 md:space-y-10">
            {PROCESS.steps.map((step, i) => {
              const Icon = STEP_ICONS[i] ?? LinkChain;
              const isActive = i === 1;
              return (
                <li key={step.title} className="max-w-[480px]">
                  <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4 text-ink" />
                    <h3 className="font-sans text-[18px] font-medium tracking-[-0.01em] text-ink">
                      {step.title}
                    </h3>
                  </div>
                  <p className="mt-3 font-mono text-[14px] leading-[22px] text-muted-ink">
                    {step.description}
                  </p>
                  {i < PROCESS.steps.length - 1 ? (
                    <div className="mt-7 h-px w-full bg-line">
                      {isActive ? <div className="h-px w-1/3 bg-ink" /> : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>

          {/* Right: Skill library card stack. */}
          <div className="relative flex items-center justify-center">
            <div className="relative aspect-[600/440] w-full max-w-[600px]">
              {/* Back card. */}
              <div className="absolute right-0 top-14 h-[300px] w-[86%] rounded-2xl border border-line bg-surface shadow-[0_20px_40px_-30px_rgba(31,41,55,0.18)]" />
              {/* Middle card. */}
              <div className="absolute right-6 top-7 h-[315px] w-[91%] rounded-2xl border border-line bg-surface shadow-[0_20px_40px_-30px_rgba(31,41,55,0.18)]" />
              {/* Front card: a real Skill. */}
              <SkillCard />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function SkillCard() {
  return (
    <article className="absolute left-0 right-0 top-0 mx-auto w-[96%] overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_24px_60px_-30px_rgba(31,31,31,0.25)]">
      <div className="flex items-center justify-between border-b border-line px-5 py-3 font-mono text-[12px] text-muted-ink">
        <span className="inline-flex items-center gap-2">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
          Skill · v3 · last run 2h ago
        </span>
        <span className="opacity-70">⌘K</span>
      </div>

      <div className="px-6 pb-5 pt-6">
        <h4 className="font-sans text-[20px] font-medium leading-[1.15] tracking-[-0.01em] text-ink">
          Summarize this week&apos;s customer calls
        </h4>
        <p className="mt-2 font-mono text-[13px] leading-[20px] text-muted-ink">
          Reads transcripts from Gmail + Drive, groups by account, surfaces three product themes per
          account, and drafts the Monday digest.
        </p>

        <div className="mt-5 flex flex-wrap items-center gap-2 font-mono text-[12px]">
          <span className="rounded-md border border-line bg-page px-2 py-1 text-ink-soft">
            Gmail
          </span>
          <span className="rounded-md border border-line bg-page px-2 py-1 text-ink-soft">
            Drive
          </span>
          <span className="rounded-md border border-line bg-page px-2 py-1 text-ink-soft">
            12 sources
          </span>
          <span className="rounded-md border border-line bg-page px-2 py-1 text-ink-soft">
            cited
          </span>
        </div>

        <div className="mt-6 flex items-center justify-between">
          <span className="font-mono text-[12px] text-muted-ink">
            Anyone on the team can run this
          </span>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-3 py-2 font-mono text-[12px] text-white"
          >
            Run Skill
            <ChevronRight className="h-3 w-3" />
          </button>
        </div>
      </div>
    </article>
  );
}
