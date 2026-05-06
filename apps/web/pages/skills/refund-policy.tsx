import Head from 'next/head';
import Link from 'next/link';
import { useState } from 'react';

import { Sidebar } from '@/components/Sidebar';
import { Button } from '@/components/ui/button';

export default function RefundPolicySkillPage() {
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setError(null);
    const response = await fetch('/api/skills/refund-policy', {
      method: 'POST',
      headers: csrfHeaders(),
    });
    if (!response.ok) {
      const payload = await response.json();
      setError(payload.error ?? 'skill_export_failed');
      return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'refund-policy-skill.zip';
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <Head>
        <title>Refund-policy Skill - Open42</title>
      </Head>
      <div className="flex min-h-screen bg-background">
        <Sidebar />
        <main className="flex-1 px-10 py-10">
          <div className="max-w-4xl">
            <p className="font-mono text-xs text-text-subtle">SKILL EXPORT</p>
            <h1 className="mt-4 text-4xl font-medium leading-headline tracking-tight text-text-primary md:text-5xl">
              refund-policy
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-body text-text-body">
              Export a source-grounded skill bundle with SKILL.md, frontmatter.yaml,
              manifest.json, citation metadata, and freshness warnings.
            </p>

            <div className="mt-8">
              <Button type="button" onClick={download}>
                Download zip
              </Button>
              <Button asChild variant="secondary" className="ml-3">
                <Link href="/chat">Ask first</Link>
              </Button>
            </div>

            {error ? (
              <div className="mt-8 rounded-2xl border border-destructive/20 bg-white p-5">
                <p className="text-sm font-medium text-destructive">{error}</p>
                <p className="mt-2 text-sm leading-body text-text-body">
                  The skill could not be generated because the workspace brain is not ready.
                </p>
              </div>
            ) : null}

            <section className="mt-12 grid gap-6 md:grid-cols-[1.3fr_0.7fr]">
              <div className="rounded-2xl border border-border bg-white p-6">
                <h2 className="text-base font-medium text-text-primary">SKILL.md preview</h2>
                <pre className="mt-4 whitespace-pre-wrap font-sans text-sm leading-body text-text-body">
{`# Refund Policy

Use this skill when answering refund, return, cancellation, or enterprise SLA refund questions.

Every claim must cite the source page and version from frontmatter.yaml.`}
                </pre>
              </div>
              <div className="rounded-2xl border border-border bg-white p-6">
                <h2 className="text-base font-medium text-text-primary">Frontmatter</h2>
                <dl className="mt-4 space-y-3 text-sm">
                  <Row label="name" value="refund-policy" />
                  <Row label="citations" value="generated from top chunks" />
                  <Row label="freshness" value="oldest/newest/stale" />
                </dl>
              </div>
            </section>
          </div>
        </main>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-mono text-xs text-text-subtle">{label}</dt>
      <dd className="mt-1 text-text-body">{value}</dd>
    </div>
  );
}

function csrfHeaders(): HeadersInit {
  const csrf = document.cookie
    .split('; ')
    .find((part) => part.startsWith('open42_csrf='))
    ?.split('=')[1];
  return csrf ? { 'X-CSRF-Token': csrf } : {};
}
