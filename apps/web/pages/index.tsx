import Head from 'next/head';
import Link from 'next/link';

import { Button } from '@/components/ui/button';

/**
 * Open42 landing page.
 * Pure-white surface, restrained typography, single accent.
 * Per DESIGN.md: hero + three principle blocks + CTA.
 */
export default function LandingPage() {
  return (
    <>
      <Head>
        <title>Open42 — Company Brain</title>
        <meta
          name="description"
          content="A self-hostable Company Brain. Your AI agents finally know your company — with citations, freshness, and exportable skills."
        />
      </Head>

      <div className="min-h-screen bg-background">
        <header className="mx-auto flex max-w-landing items-center justify-between px-6 pt-6">
          <span className="font-mono text-sm text-text-subtle">open42</span>
          <Link
            href="/signup"
            className="text-sm font-medium text-text-body transition-colors hover:text-text-primary"
          >
            Sign in
          </Link>
        </header>

        <main className="mx-auto max-w-landing px-6 pb-24 pt-16 md:pt-32">
          <h1 className="text-5xl font-medium leading-display tracking-tighter md:text-7xl">
            Your AI finally knows your company.
          </h1>

          <p className="mt-8 max-w-2xl text-lg leading-body text-text-body md:text-xl">
            Open42 turns your scattered docs — Notion, Slack, internal wikis — into a
            queryable brain that cites its sources. Your AI agents stop making things
            up. Your refund policy, your hiring criteria, your incident playbooks become
            executable knowledge.
          </p>

          <div className="mt-10 flex flex-wrap items-center gap-3">
            <Button asChild>
              <Link href="/signup">Get early access</Link>
            </Button>
            <Button asChild variant="secondary">
              <Link href="https://github.com/garrytan/gbrain">
                Built on gbrain →
              </Link>
            </Button>
          </div>

          <section className="mt-24 grid gap-12 md:mt-32 md:grid-cols-3 md:gap-8">
            <Principle
              eyebrow="01"
              title="The brain shows its receipts."
              body="Every answer cites the source page, version, and last-updated date. No more polished hallucinations. Click a citation to open the source."
            />
            <Principle
              eyebrow="02"
              title="The brain is honest about what it doesn't know."
              body="Empty results say so plainly. Stale data flags itself. When two pages disagree, conflicts surface for human resolution."
            />
            <Principle
              eyebrow="03"
              title="Skills, not just answers."
              body="Export your refund policy as an executable skill bundle. Drop it into Claude Code or any MCP-compatible agent. From now on, your AI handles refund tickets correctly."
            />
          </section>
        </main>
      </div>
    </>
  );
}

function Principle(props: { eyebrow: string; title: string; body: string }) {
  return (
    <div>
      <p className="font-mono text-xs font-medium tracking-[0.02em] text-text-subtle">
        {props.eyebrow}
      </p>
      <h3 className="mt-3 text-base font-medium leading-snug tracking-[-0.01em] text-text-primary">
        {props.title}
      </h3>
      <p className="mt-2 text-sm leading-body text-text-body">{props.body}</p>
    </div>
  );
}
