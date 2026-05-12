import { FEATURES } from "@/lib/content";
import { SectionEyebrow } from "@/components/SectionEyebrow";
import {
  LinkChain,
  CheckIcon,
  AlertTriangle,
  RocketIcon,
} from "@/components/icons";

// Each bento card carries its own inline mock — no screenshots. The mock
// shows the actual UI metaphor for that capability so the page is self-
// evident even before someone sees the product.
const MOCKS: Record<string, () => JSX.Element> = {
  receipts: ReceiptsMock,
  skills: SkillsMock,
  honest: HonestMock,
  isolated: IsolatedMock,
};

export function FeaturesSection() {
  const [c1, c2, c3, c4] = FEATURES.cards;

  if (!c1 || !c2 || !c3 || !c4) return null;

  return (
    <section id="features" className="relative bg-page">
      <div className="page-frame mx-auto w-full max-w-[1320px] px-6 pt-24 pb-24">
        <SectionEyebrow icon={<LinkChain className="h-3.5 w-3.5" />}>
          {FEATURES.eyebrow}
        </SectionEyebrow>

        <div className="mt-6 grid grid-cols-1 gap-x-12 gap-y-2 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <h2 className="font-sans text-[40px] font-medium leading-[1.0] tracking-[-0.025em] text-ink md:text-[56px]">
            {FEATURES.heading}
          </h2>
          <p className="self-end font-mono text-[16px] leading-[24px] text-muted-ink">
            {FEATURES.subhead}
          </p>
        </div>

        <div className="mt-12 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
          <BentoCard card={c1} />
          <BentoCard card={c2} />
        </div>
        <div id="skills" className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.45fr)]">
          <BentoCard card={c3} />
          <BentoCard card={c4} />
        </div>
      </div>
    </section>
  );
}

function BentoCard({ card }: { card: (typeof FEATURES.cards)[number] }) {
  const Mock = MOCKS[card.id] ?? ReceiptsMock;
  return (
    <article className="relative overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="px-7 pt-7">
        <h3 className="font-sans text-[22px] font-medium tracking-[-0.01em] text-ink">
          {card.title}
        </h3>
        <p className="mt-2 max-w-[440px] font-mono text-[14px] leading-[22px] text-muted-ink">
          {card.description}
        </p>
      </div>
      <div className="relative mt-6 flex items-end px-6 pb-6">
        <Mock />
      </div>
    </article>
  );
}

// --- Inline mocks --------------------------------------------------------

function ReceiptsMock() {
  return (
    <div className="w-full overflow-hidden rounded-xl border border-line bg-page">
      <div className="border-b border-line bg-surface px-4 py-2 font-mono text-[11px] text-muted-ink">
        answer · trace
      </div>
      <div className="space-y-2.5 px-4 py-4 font-mono text-[12px] leading-[20px]">
        <p className="text-ink">
          The 30-day refund applies unless the account is enterprise
          <SourceTag n={1} />
          <SourceTag n={2} />
        </p>
        <p className="text-muted-ink">
          Enterprise overrides need legal sign-off
          <SourceTag n={3} />
        </p>
        <div className="mt-3 grid grid-cols-1 gap-1.5 border-t border-line pt-3 text-[11px] text-muted-ink">
          <ReceiptRow n={1} src="refund-policy.md" meta="updated 2d ago" />
          <ReceiptRow n={2} src="sales-exceptions.md" meta="version 14" />
          <ReceiptRow n={3} src="legal-renewal-msa.md" meta="updated 11d ago" />
        </div>
      </div>
    </div>
  );
}

function SourceTag({ n }: { n: number }) {
  return (
    <span className="ml-1 inline-flex items-center justify-center rounded bg-blue-50 px-1.5 align-baseline font-mono text-[10px] font-medium text-blue-600 ring-1 ring-blue-100">
      {n}
    </span>
  );
}

function ReceiptRow({
  n,
  src,
  meta,
}: {
  n: number;
  src: string;
  meta: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="font-mono">
        <span className="text-blue-600">[{n}]</span> {src}
      </span>
      <span className="opacity-70">{meta}</span>
    </div>
  );
}

function SkillsMock() {
  const items = [
    { name: "Weekly customer digest", runs: "ran 12×" },
    { name: "Draft investor update", runs: "ran 4×" },
    { name: "Find stale Notion docs", runs: "ran 28×" },
  ];
  return (
    <div className="w-full overflow-hidden rounded-xl border border-line bg-page">
      <div className="flex items-center justify-between border-b border-line bg-surface px-4 py-2 font-mono text-[11px] text-muted-ink">
        <span>Skills · workspace acme</span>
        <span>3</span>
      </div>
      <ul className="divide-y divide-line">
        {items.map((s) => (
          <li
            key={s.name}
            className="flex items-center justify-between px-4 py-3 font-mono text-[12px]"
          >
            <span className="flex items-center gap-2 text-ink">
              <RocketIcon className="h-3.5 w-3.5 text-ink" />
              {s.name}
            </span>
            <span className="text-muted-ink">{s.runs}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function HonestMock() {
  return (
    <div className="w-full overflow-hidden rounded-xl border border-line bg-page">
      <div className="border-b border-line bg-surface px-4 py-2 font-mono text-[11px] text-muted-ink">
        chat · no source
      </div>
      <div className="space-y-3 px-4 py-4 font-mono text-[12px] leading-[20px]">
        <p className="text-muted-ink">
          <span className="opacity-60">user ›</span> what&apos;s our refund
          policy for trial users?
        </p>
        <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-ink">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-[2px] h-3.5 w-3.5 text-amber-600" />
            <p>
              I don&apos;t have anything about trial-user refunds in your
              brain. Add a source, or rephrase.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function IsolatedMock() {
  const tenants = [
    { name: "acme", color: "bg-blue-500" },
    { name: "globex", color: "bg-emerald-500" },
    { name: "soylent", color: "bg-amber-500" },
  ];
  return (
    <div className="w-full overflow-hidden rounded-xl border border-line bg-page">
      <div className="border-b border-line bg-surface px-4 py-2 font-mono text-[11px] text-muted-ink">
        runtime · one tenant per workspace
      </div>
      <div className="grid grid-cols-3 gap-3 px-4 py-4">
        {tenants.map((t) => (
          <div
            key={t.name}
            className="rounded-lg border border-line bg-surface p-3 font-mono text-[11px]"
          >
            <div className="flex items-center gap-1.5">
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${t.color}`} />
              <span className="text-ink">{t.name}</span>
            </div>
            <div className="mt-2 space-y-1 text-muted-ink">
              <p>gbrain · isolated</p>
              <p>postgres · /data</p>
              <p>oauth · per-tenant</p>
            </div>
          </div>
        ))}
      </div>
      <div className="border-t border-line bg-surface px-4 py-2 font-mono text-[11px] text-muted-ink">
        no shared retrieval layer
      </div>
    </div>
  );
}
