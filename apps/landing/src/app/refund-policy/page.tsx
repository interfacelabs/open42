import type { Metadata } from 'next';
import { SiteNav } from '@/components/SiteNav';
import { SiteFooter } from '@/components/SiteFooter';

export const metadata: Metadata = {
  title: 'Refund Policy — Open42',
  description: 'Refund policy for Open42 Cloud, operated by Interface Labs Ltd.',
};

export default function RefundPolicyPage() {
  return (
    <main className="flex min-h-screen flex-col bg-page">
      <SiteNav />
      <section className="page-frame mx-auto w-full max-w-[1320px] flex-1 px-6 pt-20 pb-24">
        <article className="mx-auto w-full max-w-[760px]">
          <div className="inline-flex items-center gap-2 rounded-md border border-line bg-surface px-2.5 py-1.5 font-mono text-[12px] text-muted-ink">
            Refund Policy
          </div>
          <h1 className="mt-6 font-sans text-[44px] font-medium leading-[1.0] tracking-[-0.03em] text-ink md:text-[56px]">
            Refund Policy
          </h1>
          <p className="mt-4 font-mono text-[13px] text-muted-ink">Last updated: 22 May 2026</p>

          <div className="mt-10 space-y-10">
            <p className="font-mono text-[15px] leading-[24px] text-ink-soft">
              This Refund Policy applies to Open42 Cloud subscriptions sold by Interface Labs Ltd, a
              company registered in England and Wales with its registered office at 124 City Road,
              London, England, EC1V 2NX. For billing questions, contact support@open42.ai.
            </p>

            <Clause n={1} title="Subscription price">
              <P>
                Open42 Cloud is $20 per month. There is no free trial. Payments are processed by
                Stripe and subscriptions renew monthly until cancelled.
              </P>
            </Clause>

            <Clause n={2} title="No refunds">
              <P>
                All payments are final and non-refundable except where required by law or where
                Interface Labs expressly agrees otherwise in writing. We do not provide prorated
                refunds or credits for partial months, unused time, beta limitations, or
                customer-side setup issues.
              </P>
            </Clause>

            <Clause n={3} title="Cancellation">
              <P>
                You can cancel your subscription from your Workspace settings. Cancellation stops
                future renewals and takes effect at the end of the current billing period. You will
                keep access until the end of the period you already paid for.
              </P>
            </Clause>

            <Clause n={4} title="Billing errors">
              <P>
                If you believe a charge was made in error, email{' '}
                <a
                  href="mailto:support@open42.ai"
                  className="text-ink underline-offset-4 hover:underline"
                >
                  support@open42.ai
                </a>{' '}
                with the account email, workspace name, charge date, and a short description of the
                issue. We will review billing-error claims promptly.
              </P>
            </Clause>

            <Clause n={5} title="Statutory rights">
              <P>
                Nothing in this policy limits any non-waivable consumer or statutory rights that
                apply under the law of your jurisdiction.
              </P>
            </Clause>
          </div>
        </article>
      </section>
      <SiteFooter />
    </main>
  );
}

function Clause({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
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
  return <p className="font-mono text-[14px] leading-[23px] text-muted-ink">{children}</p>;
}
