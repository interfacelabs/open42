import type { Metadata } from "next";
import { SiteNav } from "@/components/SiteNav";
import { SiteFooter } from "@/components/SiteFooter";

export const metadata: Metadata = {
  title: "About — Open42",
  description:
    "We're building Open42 — a self-hostable Company Brain that answers with receipts and turns answers into reusable Skills.",
};

export default function AboutPage() {
  return (
    <main className="flex min-h-screen flex-col bg-page">
      <SiteNav />
      <section className="page-frame mx-auto w-full max-w-[1320px] flex-1 px-6 pt-20 pb-24">
        <article className="mx-auto w-full max-w-[760px]">
        <div className="inline-flex items-center gap-2 rounded-md border border-line bg-surface px-2.5 py-1.5 font-mono text-[12px] text-muted-ink">
          About
        </div>
        <h1 className="mt-6 font-sans text-[44px] font-medium leading-[1.0] tracking-[-0.03em] text-ink md:text-[56px]">
          We&apos;re building the Company Brain we wanted to use.
        </h1>
        <div className="mt-8 space-y-5 font-mono text-[15px] leading-[24px] text-ink-soft">
          <p>
            Open42 is a self-hostable Company Brain built on{" "}
            <a
              href="https://github.com/garrytan/gbrain"
              className="text-ink underline-offset-4 hover:underline"
            >
              gbrain
            </a>
            . We answer with receipts, flag stale sources, and turn every
            useful answer into a one-click Skill anyone on the team can run.
          </p>
          <p>
            We started this because the AI tools we tried at work were
            confidently wrong, expensive to debug, and built for one person
            chatting alone. We wanted something a team could actually trust:
            tenant-isolated, citation-first, honest when it doesn&apos;t know.
          </p>
          <p>
            Get in touch:{" "}
            <a
              href="mailto:support@open42.ai"
              className="text-ink underline-offset-4 hover:underline"
            >
              support@open42.ai
            </a>
            .
          </p>
        </div>
        </article>
      </section>
      <SiteFooter />
    </main>
  );
}
