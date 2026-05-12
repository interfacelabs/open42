import type { Metadata } from "next";
import { SiteNav } from "@/components/SiteNav";
import { SiteFooter } from "@/components/SiteFooter";

export const metadata: Metadata = {
  title: "Privacy Policy — Open42",
  description: "Privacy Policy for Open42, operated by Interface Labs Ltd.",
};

export default function PrivacyPage() {
  return (
    <main className="flex min-h-screen flex-col bg-page">
      <SiteNav />
      <section className="page-frame mx-auto w-full max-w-[1320px] flex-1 px-6 pt-20 pb-24">
        <article className="mx-auto w-full max-w-[760px]">
          <div className="inline-flex items-center gap-2 rounded-md border border-line bg-surface px-2.5 py-1.5 font-mono text-[12px] text-muted-ink">
            Privacy Policy
          </div>
          <h1 className="mt-6 font-sans text-[44px] font-medium leading-[1.0] tracking-[-0.03em] text-ink md:text-[56px]">
            Privacy Policy
          </h1>
          <p className="mt-4 font-mono text-[13px] text-muted-ink">
            Last updated: 12 May 2026
          </p>

          <div className="mt-10 space-y-10">
            <p className="font-mono text-[15px] leading-[24px] text-ink-soft">
              This Privacy Policy explains how Interface Labs Ltd
              (&ldquo;Interface Labs&rdquo;, &ldquo;we&rdquo;,
              &ldquo;us&rdquo;, or &ldquo;our&rdquo;) collects, uses, and
              protects personal data when you use Open42. We&apos;re a company
              registered in England and Wales, with our registered office at
              124 City Road, London, England, EC1V 2NX. For the purposes of UK
              GDPR, Interface Labs is the data controller for personal data we
              collect about our customers and end users.
            </p>

            <Clause n={1} title="The data we collect">
              <P>We collect the following categories of personal data:</P>
              <Ul>
                <li>
                  <b>Account data</b> — your name, email address, organisation,
                  and authentication identifiers
                </li>
                <li>
                  <b>Workspace data</b> — the content you connect to your
                  Workspace (documents, messages, transcripts, files, and so
                  on), the questions you ask, the answers Open42 generates, and
                  the Skills you save
                </li>
                <li>
                  <b>Usage data</b> — request logs, request metadata, IP
                  address, browser and device information, and feature usage
                </li>
                <li>
                  <b>Billing data</b> — billing contact, billing address, and
                  payment status (card details are processed by our payment
                  processor; we don&apos;t store them ourselves)
                </li>
                <li>
                  <b>Communications</b> — emails and messages you send to us
                </li>
              </Ul>
            </Clause>

            <Clause n={2} title="How we use your data">
              <P>We use personal data to:</P>
              <Ul>
                <li>provide, operate, and improve the Service</li>
                <li>authenticate you and secure your account</li>
                <li>bill you for paid plans</li>
                <li>
                  communicate with you about your account, security, and
                  product updates
                </li>
                <li>investigate and prevent fraud, abuse, or security
                  incidents</li>
                <li>comply with legal obligations</li>
              </Ul>
              <P>
                We do not sell your personal data. We do not use the contents of
                your Workspace to train shared or third-party models.
              </P>
            </Clause>

            <Clause n={3} title="Legal bases (UK GDPR)">
              <P>We rely on the following legal bases for processing:</P>
              <Ul>
                <li>
                  <b>Performance of a contract</b> — to deliver the Service you
                  subscribed to
                </li>
                <li>
                  <b>Legitimate interests</b> — to secure, improve, and operate
                  the Service, where those interests are not overridden by your
                  rights
                </li>
                <li>
                  <b>Consent</b> — for optional features (such as marketing
                  emails) where you have opted in
                </li>
                <li>
                  <b>Legal obligation</b> — where processing is required by
                  applicable law
                </li>
              </Ul>
            </Clause>

            <Clause n={4} title="Sharing and sub-processors">
              <P>
                We share personal data with vetted sub-processors that help us
                run the Service. Our current sub-processors include:
              </P>
              <Ul>
                <li>
                  <b>Anthropic, PBC</b> — model inference (United States)
                </li>
                <li>
                  <b>OpenAI, L.L.C. / OpenAI Ireland Ltd</b> — model inference
                  (United States / Ireland)
                </li>
                <li>
                  <b>Composio</b> — connector orchestration and OAuth
                </li>
                <li>
                  <b>Supabase Inc.</b> — authentication and metadata storage
                </li>
                <li>
                  <b>Fly.io (Hashbang Industries Inc.)</b> — cloud
                  infrastructure for per-Workspace runtimes
                </li>
                <li>
                  <b>Stripe Payments Europe Ltd</b> — payment processing
                </li>
              </Ul>
              <P>
                We require each sub-processor to apply appropriate technical and
                organisational measures to protect your data. A current list is
                available on request to{" "}
                <a
                  href="mailto:support@open42.ai"
                  className="text-ink underline-offset-4 hover:underline"
                >
                  support@open42.ai
                </a>
                . We&apos;ll notify customers in advance of any material change
                to our sub-processor list.
              </P>
            </Clause>

            <Clause n={5} title="International transfers">
              <P>
                Some of our sub-processors are based outside the United Kingdom.
                When personal data leaves the UK, we rely on appropriate
                safeguards — including the UK International Data Transfer
                Agreement, the EU Standard Contractual Clauses with the UK
                Addendum, or adequacy decisions — depending on the destination.
              </P>
            </Clause>

            <Clause n={6} title="Tenant isolation">
              <P>
                Each Workspace runs on its own gbrain runtime with its own
                database. There is no shared retrieval layer between
                Workspaces. Where you bring your own API keys, those keys are
                stored separately and never reach the Workspace runtime — all
                model traffic flows through a per-Workspace egress proxy that
                resolves the real key at request time.
              </P>
            </Clause>

            <Clause n={7} title="Data retention">
              <P>
                We retain personal data for as long as we need to provide the
                Service, comply with our legal obligations, resolve disputes,
                and enforce our agreements. After you terminate your account,
                you can export Your Content for thirty (30) days, after which
                we may delete it from active systems. Backup copies may persist
                for a limited period in line with our backup schedule before
                being deleted.
              </P>
            </Clause>

            <Clause n={8} title="Your rights">
              <P>Under UK GDPR you have the right to:</P>
              <Ul>
                <li>access the personal data we hold about you</li>
                <li>have inaccurate personal data corrected</li>
                <li>request erasure, subject to legal exceptions</li>
                <li>restrict or object to certain processing</li>
                <li>receive your personal data in a portable format</li>
                <li>
                  withdraw consent at any time, for processing based on consent
                </li>
              </Ul>
              <P>
                To exercise these rights, email{" "}
                <a
                  href="mailto:support@open42.ai"
                  className="text-ink underline-offset-4 hover:underline"
                >
                  support@open42.ai
                </a>
                .
              </P>
            </Clause>

            <Clause n={9} title="Security">
              <P>
                We apply appropriate technical and organisational measures to
                protect personal data — including encryption in transit,
                encrypted secrets at rest, role-based access controls, and
                per-tenant isolation. No system is perfectly secure; if a
                personal data breach is likely to result in a risk to your
                rights and freedoms, we&apos;ll notify the ICO and affected
                customers as required by law.
              </P>
            </Clause>

            <Clause n={10} title="Cookies">
              <P>
                We use a small number of strictly necessary cookies to keep you
                signed in and to remember your session preferences. We do not
                use third-party advertising or cross-site tracking cookies.
              </P>
            </Clause>

            <Clause n={11} title="Children">
              <P>
                The Service is not intended for anyone under the age of 16. We
                do not knowingly collect personal data from children. If you
                believe a child has provided us with personal data, contact us
                and we&apos;ll delete it.
              </P>
            </Clause>

            <Clause n={12} title="Changes to this Policy">
              <P>
                We may update this Privacy Policy from time to time. If the
                changes are material, we&apos;ll let you know in advance — by
                email or in the product. The &ldquo;Last updated&rdquo; date
                above will always reflect the current version.
              </P>
            </Clause>

            <Clause n={13} title="Contact">
              <P>
                For questions about this Policy, to exercise your rights, or to
                request our current sub-processor list, email{" "}
                <a
                  href="mailto:support@open42.ai"
                  className="text-ink underline-offset-4 hover:underline"
                >
                  support@open42.ai
                </a>{" "}
                or write to Interface Labs Ltd, 124 City Road, London, England,
                EC1V 2NX.
              </P>
            </Clause>
          </div>
        </article>
      </section>
      <SiteFooter />
    </main>
  );
}

function Clause({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="font-sans text-[20px] font-medium tracking-[-0.01em] text-ink">
        {n}. {title}
      </h2>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-mono text-[14px] leading-[23px] text-muted-ink">
      {children}
    </p>
  );
}

function Ul({ children }: { children: React.ReactNode }) {
  return (
    <ul className="ml-5 list-disc space-y-1.5 font-mono text-[14px] leading-[23px] text-muted-ink marker:text-muted-ink">
      {children}
    </ul>
  );
}
