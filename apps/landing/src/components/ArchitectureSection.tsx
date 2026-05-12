import Link from "next/link";
import { ARCHITECTURE, GBRAIN } from "@/lib/content";
import { SectionEyebrow } from "@/components/SectionEyebrow";
import {
  PuzzleIcon,
  CommandIcon,
  GridIcon,
  LinkChain,
  ChevronRight,
  StarIcon,
} from "@/components/icons";

// Two-boundary architecture band. Visual is a 5-node lane: user → Open42 →
// metadata DB on one side, gbrain tenant → tenant DB on the other. The
// boundary marker between them is the load-bearing claim: no shared brain.
const NODE_ICONS = [PuzzleIcon, CommandIcon, GridIcon, LinkChain, GridIcon];

export function ArchitectureSection() {
  return (
    <section id="architecture" className="relative bg-page">
      <div className="page-frame mx-auto w-full max-w-[1320px] px-6 pt-24 pb-24">
        <SectionEyebrow icon={<PuzzleIcon className="h-3.5 w-3.5" />}>
          {ARCHITECTURE.eyebrow}
        </SectionEyebrow>

        <div className="mt-6 grid grid-cols-1 gap-x-12 gap-y-2 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <h2 className="font-sans text-[40px] font-medium leading-[1.0] tracking-[-0.025em] text-ink md:text-[56px]">
            {ARCHITECTURE.heading}
          </h2>
          <p className="self-end font-mono text-[16px] leading-[24px] text-muted-ink">
            {ARCHITECTURE.subhead}
          </p>
        </div>

        <div className="mt-14 overflow-hidden rounded-2xl border border-line bg-surface">
          {/* Boundary labels. */}
          <div className="grid grid-cols-2 border-b border-line">
            <div className="px-6 py-3 font-mono text-[11px] uppercase tracking-wider text-muted-ink">
              <span className="text-ink">Open42 boundary</span> · user + metadata
            </div>
            <div className="border-l border-line px-6 py-3 text-right font-mono text-[11px] uppercase tracking-wider text-muted-ink">
              workspace brain · per workspace
              <span className="ml-2 text-ink">gbrain boundary</span>
            </div>
          </div>

          {/* Nodes. */}
          <div className="grid grid-cols-1 gap-px bg-line md:grid-cols-5">
            {ARCHITECTURE.nodes.map((node, i) => {
              const Icon = NODE_ICONS[i] ?? PuzzleIcon;
              const isLast = i === ARCHITECTURE.nodes.length - 1;
              const isBoundary = i === 3;
              return (
                <div
                  key={node.title}
                  className="relative flex flex-col gap-3 bg-surface p-6"
                >
                  {/* Arrow between nodes on desktop. */}
                  {!isLast ? (
                    <ChevronRight
                      className="pointer-events-none absolute right-[-9px] top-1/2 z-10 hidden h-4 w-4 -translate-y-1/2 text-muted-ink md:block"
                      aria-hidden="true"
                    />
                  ) : null}
                  <div
                    className={
                      "flex h-9 w-9 items-center justify-center rounded-lg border " +
                      (isBoundary
                        ? "border-ink bg-ink text-white"
                        : "border-line bg-page text-ink")
                    }
                  >
                    <Icon className="h-4 w-4" />
                  </div>
                  <h3 className="font-sans text-[16px] font-medium tracking-[-0.01em] text-ink">
                    {node.title}
                  </h3>
                  <p className="font-mono text-[12px] leading-[19px] text-muted-ink">
                    {node.detail}
                  </p>
                </div>
              );
            })}
          </div>

          {/* Footnote. */}
          <div className="border-t border-line bg-page/60 px-6 py-3 font-mono text-[12px] text-muted-ink">
            Your API keys never reach the workspace brain. All Anthropic and
            OpenAI traffic flows through a per-workspace proxy.
          </div>
        </div>

        {/* Built on gbrain — compact band, folded in from the standalone section. */}
        <GbrainCallout />
      </div>
    </section>
  );
}

function GbrainCallout() {
  return (
    <div className="mt-8 grid grid-cols-1 gap-6 rounded-2xl border border-line bg-surface p-6 md:grid-cols-[1.2fr_1fr] md:items-center md:gap-10 md:p-7">
      <div>
        <div className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-muted-ink">
          <StarIcon className="h-3 w-3" />
          Built on gbrain
        </div>
        <h3 className="mt-3 font-sans text-[22px] font-medium tracking-[-0.01em] text-ink">
          We didn&apos;t reinvent the brain. We made it run for teams.
        </h3>
        <p className="mt-3 max-w-[520px] font-mono text-[13px] leading-[21px] text-muted-ink">
          gbrain is the open-source agent brain Garry Tan built to run his own
          daily work. Open42 pins it at a verified version, runs one isolated
          instance per workspace, and wraps it in the team layer it doesn&apos;t
          ship — auth, billing, connectors, UI.
        </p>
      </div>

      <div className="flex flex-col gap-2.5 font-mono text-[12px] leading-[18px] text-muted-ink md:items-end md:text-right">
        <span>
          <span className="text-ink">{GBRAIN.card.facts[2]?.value.split(" · ")[0]}</span>
          {" "}pages indexed in Garry&apos;s personal brain
        </span>
        <span>
          BrainBench{" "}
          <span className="text-ink">P@5 49.1</span> — beats vector-only RAG by
          +31
        </span>
        <span>MIT · 34 skills · MCP with OAuth 2.1</span>
        <Link
          href={GBRAIN.card.cta.href}
          className="mt-1 inline-flex items-center gap-1.5 self-start text-ink transition-opacity hover:opacity-70 md:self-end"
        >
          {GBRAIN.card.cta.label}
          <ChevronRight className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
}
