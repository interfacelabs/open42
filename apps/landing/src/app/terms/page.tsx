import type { Metadata } from "next";
import { SiteNav } from "@/components/SiteNav";
import { SiteFooter } from "@/components/SiteFooter";

export const metadata: Metadata = {
  title: "Terms of Service — Open42",
  description: "Terms of Service for Open42, operated by Interface Labs Ltd.",
};

export default function TermsPage() {
  return (
    <main className="flex min-h-screen flex-col bg-page">
      <SiteNav />
      <section className="page-frame mx-auto w-full max-w-[1320px] flex-1 px-6 pt-20 pb-24">
        <article className="mx-auto w-full max-w-[760px]">
          <div className="inline-flex items-center gap-2 rounded-md border border-line bg-surface px-2.5 py-1.5 font-mono text-[12px] text-muted-ink">
            Terms of Service
          </div>
          <h1 className="mt-6 font-sans text-[44px] font-medium leading-[1.0] tracking-[-0.03em] text-ink md:text-[56px]">
            Terms of Service
          </h1>
          <p className="mt-4 font-mono text-[13px] text-muted-ink">
            Last updated: 12 May 2026
          </p>

          <div className="mt-10 space-y-10">
            <p className="font-mono text-[15px] leading-[24px] text-ink-soft">
              These Terms of Service (the &ldquo;Terms&rdquo;) govern your access
              to and use of Open42 (the &ldquo;Service&rdquo;), operated by
              Interface Labs Ltd (&ldquo;Interface Labs&rdquo;,
              &ldquo;we&rdquo;, &ldquo;us&rdquo;, or &ldquo;our&rdquo;), a
              company registered in England and Wales with its registered office
              at 124 City Road, London, England, EC1V 2NX. By using the Service,
              you agree to these Terms. If you don&apos;t agree, please
              don&apos;t use the Service.
            </p>

            <Clause n={1} title="The Service">
              <P>
                Open42 is a self-hostable Company Brain that ingests content
                from your workspace tools, answers questions with citations, and
                lets you save answers as reusable Skills. The Service is offered
                in two delivery models: a managed cloud product
                (&ldquo;Open42 Cloud&rdquo;) and an open-source self-hosted
                distribution (&ldquo;Open42 Self-Hosted&rdquo;). These Terms
                apply to Open42 Cloud. The Self-Hosted distribution is governed
                by its open-source licence.
              </P>
            </Clause>

            <Clause n={2} title="Accounts and eligibility">
              <P>
                You must be at least 18 years old to create an account. You are
                responsible for keeping your credentials secure and for activity
                that occurs under your account. You agree to provide accurate
                information and to keep it up to date.
              </P>
            </Clause>

            <Clause n={3} title="Workspaces and roles">
              <P>
                Each customer has one or more Workspaces. Workspace
                administrators can invite members, configure connectors, manage
                billing, and grant or revoke access. You agree that your
                administrators act on your behalf, and that their actions bind
                your organisation.
              </P>
            </Clause>

            <Clause n={4} title="Your Content">
              <P>
                You retain all rights to the content you connect to the Service,
                the questions you ask, the answers Open42 generates from your
                sources, and the Skills you create (&ldquo;Your Content&rdquo;).
                You grant Interface Labs a limited, non-exclusive licence to
                host, process, transmit, and display Your Content solely to
                provide the Service to you and to comply with legal
                obligations.
              </P>
              <P>
                We do not sell Your Content. We do not use the contents of your
                Workspace to train shared or third-party models. Each Workspace
                runs on its own isolated runtime; there is no shared retrieval
                layer between Workspaces.
              </P>
            </Clause>

            <Clause n={5} title="Acceptable use">
              <P>You agree not to:</P>
              <Ul>
                <li>use the Service in violation of any law or third-party right</li>
                <li>
                  attempt to circumvent per-Workspace isolation, access another
                  customer&apos;s data, or probe the Service for vulnerabilities
                  without our prior written consent
                </li>
                <li>
                  upload malware, content that infringes intellectual property,
                  or content that is unlawful, defamatory, or otherwise harmful
                </li>
                <li>
                  resell or sublicense the Service without our prior written
                  consent
                </li>
                <li>
                  use the Service to build a competing product or to benchmark
                  it for the purpose of disparagement
                </li>
              </Ul>
              <P>
                We may suspend or terminate your access for serious or repeated
                breaches.
              </P>
            </Clause>

            <Clause n={6} title="Subscriptions, fees, and cancellation">
              <P>
                If you subscribe to a paid plan, you agree to pay the fees shown
                at checkout. Subscriptions renew automatically for the same term
                until cancelled. You can cancel at any time from your Workspace
                settings; cancellation takes effect at the end of the current
                billing period. Unless required by law, fees already paid are
                non-refundable.
              </P>
            </Clause>

            <Clause n={7} title="Third-party services">
              <P>
                Open42 integrates with third-party services (for example,
                Anthropic, OpenAI, Composio, Supabase, Fly.io, and Stripe). Your
                use of those services is governed by their own terms. We&apos;re
                not responsible for the availability, behaviour, or content of
                third-party services. Where you choose to bring your own API
                keys, you remain responsible for your relationship with the
                upstream provider.
              </P>
            </Clause>

            <Clause n={8} title="Intellectual property">
              <P>
                Interface Labs owns all rights to the Service, including the
                software (other than open-source components, which remain under
                their respective licences), the trademarks, and the content we
                provide. You receive a limited, non-exclusive, non-transferable
                right to use the Service in accordance with these Terms. No
                other rights are granted by implication.
              </P>
            </Clause>

            <Clause n={9} title="Confidentiality">
              <P>
                Each party agrees to keep the other party&apos;s non-public
                information confidential, to use it only to perform under these
                Terms, and to protect it with at least reasonable care.
              </P>
            </Clause>

            <Clause n={10} title="Warranties and disclaimers">
              <P>
                The Service is provided &ldquo;as is&rdquo; and &ldquo;as
                available&rdquo;. To the maximum extent permitted by law, we
                disclaim all implied warranties, including merchantability,
                fitness for a particular purpose, and non-infringement. Open42
                grounds answers in your sources, but you remain responsible for
                verifying answers before relying on them — particularly for
                decisions that affect your business, legal, or financial
                position.
              </P>
            </Clause>

            <Clause n={11} title="Limitation of liability">
              <P>
                To the maximum extent permitted by law, neither party will be
                liable for indirect, incidental, special, consequential, or
                punitive damages, or for lost profits, revenues, or data. Our
                aggregate liability arising out of or related to these Terms
                will not exceed the fees you paid us in the twelve (12) months
                preceding the event giving rise to the claim. Nothing in these
                Terms limits liability for death or personal injury caused by
                negligence, for fraud, or for any other liability that cannot be
                limited under applicable law.
              </P>
            </Clause>

            <Clause n={12} title="Indemnification">
              <P>
                You agree to indemnify and hold Interface Labs harmless from any
                third-party claim arising from your breach of these Terms, your
                misuse of the Service, or Your Content.
              </P>
            </Clause>

            <Clause n={13} title="Termination">
              <P>
                You may terminate your subscription at any time from your
                Workspace settings. We may suspend or terminate your access if
                you materially breach these Terms or if we&apos;re required to
                do so by law. On termination, your right to use the Service
                ends. We will make Your Content available for export for thirty
                (30) days after termination, after which we may delete it from
                active systems. Backups may persist for a limited period in line
                with our retention schedule.
              </P>
            </Clause>

            <Clause n={14} title="Changes to the Terms">
              <P>
                We may update these Terms from time to time. If the changes are
                material, we&apos;ll let you know in advance — by email or in
                the product. Your continued use of the Service after the changes
                take effect means you accept the updated Terms.
              </P>
            </Clause>

            <Clause n={15} title="Governing law and jurisdiction">
              <P>
                These Terms are governed by the laws of England and Wales. Any
                dispute arising out of or in connection with these Terms,
                including any question regarding their existence, validity, or
                termination, will be subject to the exclusive jurisdiction of
                the courts of England and Wales.
              </P>
            </Clause>

            <Clause n={16} title="Contact">
              <P>
                For questions about these Terms, email{" "}
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
