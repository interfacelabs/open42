import Head from 'next/head';
import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  ArrowRight,
  BookOpen,
  Braces,
  CheckCircle2,
  Database,
  Github,
  LockKeyhole,
  Server,
} from 'lucide-react';

const appUrl = process.env.NEXT_PUBLIC_OPEN42_APP_URL ?? 'http://localhost:3000';
const docsUrl = process.env.NEXT_PUBLIC_OPEN42_DOCS_URL ?? '#architecture';

export default function LandingPage() {
  return (
    <>
      <Head>
        <title>Open42 - Company Brain With Receipts</title>
        <meta
          name="description"
          content="Open42 turns company knowledge into a cited, tenant-isolated brain for operators and AI agents."
        />
      </Head>

      <main className="page-shell">
        <Hero />
        <ProofStrip />
        <SectionIntro />
        <ArchitectureBand />
        <UseCases />
        <FinalCta />
      </main>
    </>
  );
}

function Hero() {
  return (
    <section className="hero" aria-labelledby="hero-title">
      <header className="topbar">
        <Link className="brand-mark" href="/" aria-label="Open42 home">
          <span className="brand-dot" />
          <span>Open42</span>
        </Link>
        <nav className="topnav" aria-label="Primary">
          <a href="#architecture">Architecture</a>
          <a href="#proof">Proof</a>
          <a href="https://github.com/interfacelabs/open42">GitHub</a>
        </nav>
      </header>

      <div className="hero-scene" aria-hidden="true">
        <div className="source-stack source-stack-left">
          <EvidencePage title="Refund policy" tag="source: notion" lines={['Eligibility: 30 days', 'Exceptions: enterprise', 'Owner: support ops']} />
          <EvidencePage title="Incident runbook" tag="source: wiki" lines={['Escalate after 12 min', 'Pager: platform', 'Customer copy: approved']} />
        </div>
        <div className="brain-console">
          <div className="console-header">
            <span>tenant brain</span>
            <span>engine: postgres</span>
          </div>
          <div className="console-question">Can an annual plan get a refund?</div>
          <div className="console-answer">
            Yes, within 30 days unless the account is on an enterprise exception.
          </div>
          <div className="citation-row">
            <span>refund-policy.md</span>
            <span>updated 2d ago</span>
          </div>
          <div className="citation-row">
            <span>sales-exceptions.md</span>
            <span>version 14</span>
          </div>
        </div>
        <div className="source-stack source-stack-right">
          <EvidencePage title="Sales exceptions" tag="source: drive" lines={['Enterprise: custom SLA', 'Legal approval required', 'Renewal clause: section 8']} />
          <EvidencePage title="Support macros" tag="source: slack" lines={['Use direct answer first', 'Attach policy citation', 'Escalate if disputed']} />
        </div>
      </div>

      <div className="hero-copy">
        <p className="eyebrow">Self-hostable company memory for agents</p>
        <h1 id="hero-title">Open42</h1>
        <p className="hero-lede">
          A company brain that answers with citations, freshness, and tenant-isolated
          storage. Built on gbrain for teams that need AI to know the actual company,
          not a vague summary of it.
        </p>
        <div className="hero-actions">
          <a className="button button-primary" href={`${appUrl}/sign_in`}>
            <span>Start with your docs</span>
            <ArrowRight size={18} strokeWidth={1.7} />
          </a>
          <a className="button button-secondary" href={docsUrl}>
            <BookOpen size={18} strokeWidth={1.7} />
            <span>Read architecture</span>
          </a>
        </div>
      </div>
    </section>
  );
}

function EvidencePage(props: { title: string; tag: string; lines: string[] }) {
  return (
    <div className="evidence-page">
      <div>
        <p className="evidence-title">{props.title}</p>
        <p className="evidence-tag">{props.tag}</p>
      </div>
      <div className="evidence-lines">
        {props.lines.map((line) => (
          <span key={line}>{line}</span>
        ))}
      </div>
    </div>
  );
}

function ProofStrip() {
  const items = [
    ['One tenant', 'one Postgres + pgvector store'],
    ['OAuth DCR', 'per-workspace gbrain client'],
    ['Citations', 'source, version, freshness'],
  ];
  return (
    <section id="proof" className="proof-strip" aria-label="Open42 proof points">
      {items.map(([label, value]) => (
        <div className="proof-item" key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </section>
  );
}

function SectionIntro() {
  return (
    <section className="section intro-section">
      <div className="section-kicker">What changes</div>
      <div className="intro-grid">
        <h2>Your internal knowledge becomes operational infrastructure.</h2>
        <p>
          Open42 keeps the interface calm, the storage boundary explicit, and the
          answer path inspectable. The product is not a chatbot skin. It is a company
          memory layer your agents can safely call.
        </p>
      </div>
    </section>
  );
}

function ArchitectureBand() {
  return (
    <section id="architecture" className="section architecture-band">
      <div className="section-kicker">Runtime model</div>
      <div className="architecture-layout">
        <div>
          <h2>Two boundaries, no shared tenant brain.</h2>
          <p>
            Open42 handles user auth and metadata. gbrain handles the tenant brain.
            Each tenant runs in its own runtime with its own embedded Postgres and
            pgvector store mounted at <code>/data</code>.
          </p>
        </div>
        <div className="runtime-map" aria-label="Runtime architecture diagram">
          <RuntimeNode icon={<LockKeyhole size={20} />} title="Supabase user auth" body="Magic link identity plus Open42 server session." />
          <RuntimeNode icon={<Server size={20} />} title="Open42 API" body="Routes sessions, connectors, chat, and skills." />
          <RuntimeNode icon={<Database size={20} />} title="Metadata Postgres" body="Users, workspaces, encrypted gbrain secrets." />
          <RuntimeNode icon={<Braces size={20} />} title="gbrain tenant" body="Private HTTP MCP with OAuth, citations, and tools." />
          <RuntimeNode icon={<Database size={20} />} title="Tenant Postgres" body="Isolated pages, chunks, embeddings, and OAuth clients." />
        </div>
      </div>
    </section>
  );
}

function RuntimeNode(props: { icon: ReactNode; title: string; body: string }) {
  return (
    <div className="runtime-node">
      <div className="node-icon">{props.icon}</div>
      <div>
        <h3>{props.title}</h3>
        <p>{props.body}</p>
      </div>
    </div>
  );
}

function UseCases() {
  const cases = [
    {
      title: 'Answers with receipts',
      body: 'Every response can point back to source material, version, and freshness instead of relying on model confidence.',
    },
    {
      title: 'Tenant-local brain state',
      body: 'Fly tenants get their own Machine and volume. Local tenants get their own container and Docker volume.',
    },
    {
      title: 'Exportable skills',
      body: 'Policy knowledge can become executable agent instructions with citations attached.',
    },
  ];
  return (
    <section className="section use-cases">
      <div className="section-kicker">Why it matters</div>
      <div className="use-case-grid">
        {cases.map((item) => (
          <article className="use-case" key={item.title}>
            <CheckCircle2 size={20} strokeWidth={1.8} />
            <h3>{item.title}</h3>
            <p>{item.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="final-cta">
      <div>
        <p className="eyebrow">Built for operators who need trust, not theater</p>
        <h2>Give your AI the company memory it keeps pretending to have.</h2>
      </div>
      <div className="final-actions">
        <a className="button button-primary" href={`${appUrl}/sign_in`}>
          <span>Start setup</span>
          <ArrowRight size={18} strokeWidth={1.7} />
        </a>
        <a className="button button-secondary" href="https://github.com/interfacelabs/open42">
          <Github size={18} strokeWidth={1.7} />
          <span>View source</span>
        </a>
      </div>
    </section>
  );
}
