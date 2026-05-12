import { INTEGRATION } from "@/lib/content";
import { SectionEyebrow } from "@/components/SectionEyebrow";
import { OcularLogoMark, LinkChain } from "@/components/icons";

export function IntegrationSection() {
  const connectors = INTEGRATION.connectors;
  const centerIndex = Math.floor(connectors.length / 2);

  return (
    <section className="relative bg-page">
      <div className="page-frame mx-auto w-full max-w-[1320px] px-6 pt-16 pb-16">
        <div className="flex flex-col items-center text-center">
          <SectionEyebrow icon={<LinkChain className="h-3.5 w-3.5" />}>
            {INTEGRATION.eyebrow}
          </SectionEyebrow>
          <h2 className="mt-5 max-w-[680px] font-sans text-[28px] font-medium leading-[1.1] tracking-[-0.02em] text-ink md:text-[36px]">
            {INTEGRATION.heading}
          </h2>
        </div>

        <div className="relative mt-10 overflow-hidden">
          {/* Fade masks left/right. */}
          <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-24 bg-gradient-to-r from-page to-transparent" />
          <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-24 bg-gradient-to-l from-page to-transparent" />

          <ul className="flex flex-wrap items-center justify-center gap-3">
            {connectors.map((name, i) => {
              const isCenter = i === centerIndex;
              if (isCenter) {
                return (
                  <li key={name}>
                    <div className="inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2 font-mono text-[13px] text-white ring-4 ring-page">
                      <OcularLogoMark className="h-3.5 w-3.5" />
                      {name}
                    </div>
                  </li>
                );
              }
              return (
                <li key={name}>
                  <div className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3.5 py-2 font-mono text-[13px] text-ink-soft">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-muted-ink/40" />
                    {name}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        <p className="mt-8 text-center font-mono text-[13px] text-muted-ink">
          More connectors via Composio. Same security and citations on every one.
        </p>
      </div>
    </section>
  );
}
