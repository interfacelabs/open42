import Head from 'next/head';
import { useRouter } from 'next/router';
import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import useSWR from 'swr';

import { ConnectSourcesStep } from '@/components/onboarding/ConnectSourcesStep';
import { EditorialPane } from '@/components/onboarding/EditorialPane';
import { EnvelopeStage } from '@/components/onboarding/EnvelopeStage';
import { Nameplate } from '@/components/onboarding/Nameplate';
import { BrainSpinUp } from '@/components/onboarding/illustrations/BrainSpinUp';
import { PaperBoats } from '@/components/onboarding/illustrations/PaperBoats';
import {
  CurrentPayload,
  OnboardStep,
  WorkspaceRuntime,
  deriveOnboardStep,
} from '@/lib/onboarding/derive';
import { EASE_STANDARD } from '@/lib/motion';

interface OnboardCurrentPayload extends CurrentPayload {
  workspace: { id: string; name: string; runtime: WorkspaceRuntime } | null;
  invites: Array<{ id: string; email: string; status: string }>;
  user: { id: string; email: string };
}

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) {
    const err = new Error('fetch_failed') as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return res.json();
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isValidEmail = (s: string) => EMAIL_RE.test(s.trim().toLowerCase());
const parseLines = (text: string): string[] =>
  text
    .split(/[,;\n]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

export default function OnboardPage() {
  const router = useRouter();
  const urlStep = typeof router.query.step === 'string' ? router.query.step : null;
  // On the provisioning step we need to poll until runtime flips to 'ready'.
  // SWR's refreshInterval is read on every render, so we can flip it from a
  // local state that updates as the derived step changes.
  const [pollMs, setPollMs] = useState(0);
  const { data: current, error, mutate, isLoading, isValidating } = useSWR<OnboardCurrentPayload>(
    '/api/workspaces/current',
    fetcher,
    { refreshInterval: pollMs },
  );

  // Lifted so the editorial pane reacts live to the form as the user types.
  const [workspaceName, setWorkspaceName] = useState<string>('');
  const [seededFromServer, setSeededFromServer] = useState(false);
  const [inviteText, setInviteText] = useState<string>('');

  useEffect(() => {
    // Only redirect on a *settled* 401 — SWR returns the previously cached
    // error immediately on mount, so a stale 401 from before sign-in would
    // bounce the user back to /sign_in even when the new session is valid.
    if (isValidating) return;
    if (error && (error as { status?: number }).status === 401) {
      void router.replace('/sign_in');
    }
  }, [error, isValidating, router]);

  // Seed the workspace input from the server payload exactly once when current arrives.
  useEffect(() => {
    if (!seededFromServer && current?.workspace?.name) {
      setWorkspaceName(current.workspace.name);
      setSeededFromServer(true);
    }
  }, [current, seededFromServer]);

  const step: OnboardStep | null = current ? deriveOnboardStep(current, urlStep) : null;
  const topbarWorkspaceName = current?.workspace?.name ?? '';

  const inviteLines = useMemo(() => parseLines(inviteText), [inviteText]);

  // Poll on the provisioning step; idle otherwise.
  useEffect(() => {
    setPollMs(step === 'provisioning' ? 1500 : 0);
  }, [step]);

  // When the runtime flips ready while we're on the provisioning step,
  // hand off to the next step (connect a source). When derive returns null
  // (onboarding fully complete — workspace ready + at least one connection),
  // hand off to the dashboard at /.
  const runtime = current?.workspace?.runtime;
  useEffect(() => {
    if (!current) return;
    if (step === 'provisioning' && runtime === 'ready') {
      void router.replace('/onboard?step=connect');
      return;
    }
    if (step === null) {
      void router.replace('/');
    }
  }, [current, step, runtime, router]);

  return (
    <>
      <Head>
        <title>Set up your brain - Open42</title>
      </Head>
      <main className="min-h-screen bg-background">
        <div className="grid min-h-screen grid-cols-1 md:grid-cols-[1.25fr_1fr]">
          <div className="flex flex-1 flex-col px-6 py-8 md:px-16 md:py-12">
            <TopBar step={step} workspaceName={topbarWorkspaceName} />

            <div className="mt-12 flex flex-1 items-start md:mt-16 md:items-center">
              <div
                className={`w-full ${
                  step === 'connect' ? 'max-w-[560px]' : 'max-w-[460px]'
                }`}
              >
                {isLoading || !current ? (
                  <p className="font-mono text-xs text-text-subtle" aria-live="polite">
                    {error && (error as { status?: number }).status !== 401
                      ? 'Couldn\u2019t load your workspace. Refresh to try again.'
                      : 'Loading\u2026'}
                  </p>
                ) : step === 'workspace' ? (
                  <WorkspaceStep
                    name={workspaceName}
                    setName={setWorkspaceName}
                    mutate={mutate}
                  />
                ) : step === 'provisioning' ? (
                  <ProvisioningStep current={current} mutate={mutate} />
                ) : step === 'connect' ? (
                  <ConnectSourcesStep
                    runtime={current.workspace?.runtime ?? 'provisioning'}
                    mutate={mutate}
                  />
                ) : step === 'invite' ? (
                  <InviteStep
                    current={current}
                    text={inviteText}
                    setText={setInviteText}
                    lines={inviteLines}
                    mutate={mutate}
                  />
                ) : (
                  // Onboarding complete — the redirect-effect above will push
                  // to /. Render a stub while the navigation lands.
                  <p className="font-mono text-xs text-text-subtle" aria-live="polite">
                    {'All set\u2026'}
                  </p>
                )}
              </div>
            </div>
          </div>

          {step === 'invite' ? (
            <EditorialPane
              quote={
                <>
                  A brain you can&rsquo;t share
                  <br />
                  is just <em>a notebook.</em>
                </>
              }
              attribution="— OPEN42 OPERATING PRINCIPLE №2"
              illustration={<EnvelopeStage lines={inviteLines} isValid={isValidEmail} />}
            />
          ) : step === 'provisioning' ? (
            <EditorialPane
              quote={
                <>
                  A brain isn&rsquo;t built in a day.
                  <br />
                  <em>But almost.</em>
                </>
              }
              attribution="— OPEN42 OPERATING PRINCIPLE №3"
              illustration={
                <BrainSpinUp failed={current?.workspace?.runtime === 'failed'} />
              }
            />
          ) : step === 'connect' ? (
            <EditorialPane
              quote={
                <>
                  A library is just a building.
                  <br />
                  <em>The books are what matter.</em>
                </>
              }
              attribution="— OPEN42 OPERATING PRINCIPLE №4"
              illustration={<PaperBoats />}
            />
          ) : (
            <EditorialPane
              quote={
                <>
                  Every brain has <em>a name.</em>
                  <br />
                  Pick one your team <em>recognizes.</em>
                </>
              }
              attribution="— OPEN42 OPERATING PRINCIPLE №1"
              illustration={<Nameplate value={workspaceName} />}
            />
          )}
        </div>
      </main>
    </>
  );
}

function TopBar({
  step,
  workspaceName,
}: {
  step: OnboardStep | null;
  workspaceName: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="flex items-center gap-2 font-mono text-[13px] font-medium text-text-primary">
        <span className="h-[10px] w-[10px] rounded-full bg-accent" aria-hidden="true" />
        open42
        {workspaceName ? (
          <span className="text-text-subtle">&middot; {workspaceName}</span>
        ) : null}
      </span>
      <ProgressIndicator step={step} />
    </div>
  );
}

type DotState = 'active' | 'done' | 'pending';

function ProgressIndicator({ step }: { step: OnboardStep | null }) {
  const dots: [DotState, DotState, DotState, DotState] = useMemo(() => {
    if (step === 'workspace') return ['active', 'pending', 'pending', 'pending'];
    if (step === 'invite') return ['done', 'active', 'pending', 'pending'];
    if (step === 'provisioning') return ['done', 'done', 'active', 'pending'];
    if (step === 'connect') return ['done', 'done', 'done', 'active'];
    return ['pending', 'pending', 'pending', 'pending'];
  }, [step]);

  const label =
    step === 'workspace'
      ? 'Workspace'
      : step === 'invite'
        ? 'Invite'
        : step === 'provisioning'
          ? 'Spinning up'
          : step === 'connect'
            ? 'Connect a source'
            : '';

  return (
    <div className="flex items-center gap-2.5 font-mono text-[11px] text-text-subtle">
      {label ? <span className="font-medium text-text-primary">{label}</span> : null}
      <div className="flex items-center gap-1.5" aria-label="onboarding progress">
        <Dot state={dots[0]} />
        <Connector state={lineState(dots[0], dots[1])} />
        <Dot state={dots[1]} />
        <Connector state={lineState(dots[1], dots[2])} />
        <Dot state={dots[2]} />
        <Connector state={lineState(dots[2], dots[3])} />
        <Dot state={dots[3]} />
      </div>
    </div>
  );
}

function lineState(a: DotState, b: DotState): 'done' | 'pending' {
  if (a === 'done' && (b === 'done' || b === 'active')) return 'done';
  return 'pending';
}

function Dot({ state }: { state: DotState }) {
  const cls =
    state === 'active'
      ? 'bg-accent'
      : state === 'done'
        ? 'bg-accent opacity-55'
        : 'bg-[#e5e5e5]';
  return (
    <span
      className={`h-[7px] w-[7px] rounded-full transition-colors duration-200 ${cls}`}
      aria-hidden="true"
    />
  );
}

function Connector({ state }: { state: 'done' | 'pending' }) {
  const cls = state === 'done' ? 'bg-accent opacity-55' : 'bg-[#e5e5e5]';
  return <span className={`h-px w-[18px] ${cls}`} aria-hidden="true" />;
}

function PulsingNote({ children }: { children: ReactNode }) {
  return (
    <p className="mt-12 flex items-center gap-2 text-xs leading-[1.7] text-text-subtle">
      <span
        className="h-[7px] w-[7px] rounded-full bg-accent"
        style={{ animation: 'pulse 1.6s ease-in-out infinite' }}
        aria-hidden="true"
      />
      {children}
    </p>
  );
}

function WorkspaceStep({
  name,
  setName,
  mutate,
}: {
  name: string;
  setName: (value: string) => void;
  mutate: () => Promise<unknown>;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const trimmed = name.trim();
      if (!trimmed || submitting) return;
      setSubmitting(true);
      setError(null);
      try {
        const response = await fetch('/api/workspaces/onboarding/workspace', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
          body: JSON.stringify({ name: trimmed }),
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          setError(payload.error ?? 'workspace_failed');
          setSubmitting(false);
          return;
        }
        await mutate();
        await router.replace('/onboard?step=invite');
      } catch {
        setError('network_error');
        setSubmitting(false);
      }
    },
    [name, submitting, mutate, router],
  );

  return (
    <motion.div
      key="workspace"
      initial={{ opacity: 0, y: 4 }}
      animate={{
        opacity: 1,
        y: 0,
        transition: { duration: 0.2, ease: EASE_STANDARD },
      }}
    >
      <h1 className="text-[38px] font-medium leading-[1.06] tracking-[-0.025em] text-text-primary">
        Name{' '}
        <em className="font-newsreader font-normal italic text-text-primary">
          your brain.
        </em>
      </h1>
      <p className="mt-3.5 max-w-[42ch] text-sm leading-body text-text-body">
        A workspace is one company&rsquo;s brain. Pick something your team will recognize
        &mdash; you can rename it later.
      </p>
      <form onSubmit={submit} className="mt-7" noValidate>
        <label
          htmlFor="workspace-name"
          className="mb-2 block text-[13px] font-medium text-text-primary"
        >
          Workspace name
        </label>
        <input
          id="workspace-name"
          type="text"
          autoComplete="off"
          required
          maxLength={80}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Speedrun Labs"
          className="h-11 w-full rounded-input border border-input bg-white px-3.5 text-[15px] text-text-primary outline-none transition-[border-color,box-shadow] duration-140 focus:border-accent focus:shadow-[0_0_0_4px_rgba(29,77,255,0.10)]"
        />
        <p className="mt-2 text-xs text-text-subtle">
          80 characters max. Letters, numbers, spaces.
        </p>
        <button
          type="submit"
          disabled={submitting || !name.trim()}
          className="mt-6 inline-flex h-11 items-center justify-center rounded-xl bg-accent px-6 text-[15px] font-medium tracking-[-0.01em] text-white transition-[filter,transform] duration-140 hover:brightness-110 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? 'Saving\u2026' : 'Continue \u2192'}
        </button>
        {error ? (
          <p role="alert" className="mt-3 text-[13px] font-medium text-destructive">
            {humanizeError(error)}
          </p>
        ) : null}
      </form>
      <PulsingNote>
        We&rsquo;ll prepare your private brain runtime in the background.
      </PulsingNote>
    </motion.div>
  );
}

function InviteStep({
  current,
  text,
  setText,
  lines,
  mutate,
}: {
  current: OnboardCurrentPayload;
  text: string;
  setText: (value: string) => void;
  lines: string[];
  mutate: () => Promise<unknown>;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const validEmails = useMemo(() => lines.filter(isValidEmail), [lines]);

  const removeChip = useCallback(
    (target: string) => {
      const lower = target.toLowerCase();
      const next = text
        .split(/(\r?\n|,|;)/)
        .filter((tok) => tok.trim().toLowerCase() !== lower)
        .join('');
      setText(next.replace(/(\r?\n|,|;)+\s*$/g, '').replace(/^(\r?\n|,|;)+/g, ''));
    },
    [text, setText],
  );

  const submit = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    setWarning(null);
    try {
      const response = await fetch('/api/workspaces/onboarding/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
        body: JSON.stringify({ emails: validEmails }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        setError(payload.error ?? 'invites_failed');
        setSubmitting(false);
        return;
      }
      const payload = await response.json().catch(() => ({}));
      await mutate();
      const failed = payload.failed ?? 0;
      const sent = payload.sent ?? 0;
      if (failed > 0) {
        setWarning(`couldn\u2019t email ${failed} of ${sent + failed}`);
        await new Promise((resolve) => setTimeout(resolve, 600));
      }
      await router.push('/onboard?step=provisioning');
    } catch {
      setError('network_error');
      setSubmitting(false);
    }
  }, [submitting, validEmails, mutate, router]);

  const skip = useCallback(() => {
    void router.push('/onboard?step=provisioning');
  }, [router]);

  const runtime = current.workspace?.runtime ?? 'pending';
  const runtimeLabel =
    runtime === 'ready'
      ? 'Brain runtime: ready'
      : runtime === 'failed'
        ? 'Brain runtime: failed \u2014 we\u2019ll retry on the dashboard'
        : 'Brain runtime: spinning up\u2026';

  return (
    <motion.div
      key="invite"
      initial={{ opacity: 0, y: 4 }}
      animate={{
        opacity: 1,
        y: 0,
        transition: { duration: 0.2, ease: EASE_STANDARD },
      }}
    >
      <h1 className="text-[38px] font-medium leading-[1.06] tracking-[-0.025em] text-text-primary">
        Who else{' '}
        <em className="font-newsreader font-normal italic text-text-primary">
          needs this brain?
        </em>
      </h1>
      <p className="mt-3.5 max-w-[42ch] text-sm leading-body text-text-body">
        Add teammates by email &mdash; comma or newline-separated. Watch the right side as
        you type.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        className="mt-7"
        noValidate
      >
        <label
          htmlFor="invite-emails"
          className="mb-2 block text-[13px] font-medium text-text-primary"
        >
          Email addresses
        </label>
        <textarea
          id="invite-emails"
          rows={5}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="founder@speedrun.dev, ops@speedrun.dev"
          className="w-full rounded-input border border-input bg-white px-3.5 py-3 text-[14px] leading-body text-text-primary outline-none transition-[border-color,box-shadow] duration-140 focus:border-accent focus:shadow-[0_0_0_4px_rgba(29,77,255,0.10)] font-sans resize-y"
        />
        {validEmails.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {validEmails.map((email) => (
              <span
                key={email}
                className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-1 font-mono text-[11px] font-medium text-accent-deep"
              >
                {email}
                <button
                  type="button"
                  onClick={() => removeChip(email)}
                  aria-label={`remove ${email}`}
                  className="flex h-3 w-3 items-center justify-center text-accent-deep hover:opacity-70"
                >
                  <svg
                    viewBox="0 0 10 10"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.5}
                    width={10}
                    height={10}
                  >
                    <path d="M2 2 L8 8 M8 2 L2 8" />
                  </svg>
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <p className="mt-2 text-xs text-text-subtle">
          {lines.length === 0 ? (
            <>Type one email per line. The right side reacts as you go.</>
          ) : (
            <>
              <b className="font-medium text-text-primary">{validEmails.length}</b> valid
              email{validEmails.length === 1 ? '' : 's'} of{' '}
              <b className="font-medium text-text-primary">{lines.length}</b> &mdash;
              they&rsquo;ll receive an invite from{' '}
              <code className="font-mono text-[11px]">
                open42 &lt;noreply@open42.app&gt;
              </code>
              .
            </>
          )}
        </p>
        <div className="mt-3 flex items-center gap-3 font-mono text-[10px] text-text-subtle">
          <span className="inline-flex items-center gap-1.5">
            <span
              className="inline-block h-3 w-[18px] rounded-sm border-[1.4px] border-accent"
              aria-hidden="true"
            />
            valid email
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span
              className="inline-block h-3 w-[18px] rounded-sm border-[1.4px] border-dashed border-accent opacity-60"
              aria-hidden="true"
            />
            still typing&hellip;
          </span>
        </div>
        <div className="mt-6 flex items-center gap-2">
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex h-11 items-center justify-center rounded-xl bg-accent px-5 text-[15px] font-medium tracking-[-0.01em] text-white transition-[filter,transform] duration-140 hover:brightness-110 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? 'Sending\u2026' : 'Send invites \u00b7 Continue \u2192'}
          </button>
          <button
            type="button"
            onClick={skip}
            disabled={submitting}
            className="inline-flex h-11 items-center justify-center rounded-xl bg-transparent px-4 text-sm font-medium text-text-subtle transition-colors duration-140 hover:bg-[#fafafa] hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-60"
          >
            Skip for now
          </button>
        </div>
        {error ? (
          <p role="alert" className="mt-3 text-[13px] font-medium text-destructive">
            {humanizeError(error)}
          </p>
        ) : null}
        {warning ? (
          <p role="status" className="mt-3 text-[13px] font-medium text-text-subtle">
            {warning}
          </p>
        ) : null}
      </form>
      <PulsingNote>{runtimeLabel}</PulsingNote>
    </motion.div>
  );
}

function ProvisioningStep({
  current,
  mutate,
}: {
  current: OnboardCurrentPayload;
  mutate: () => Promise<unknown>;
}) {
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  const runtime: WorkspaceRuntime = current.workspace?.runtime ?? 'provisioning';
  const failed = runtime === 'failed';
  const overdue = runtime === 'overdue';

  const headline = failed ? (
    <>
      Provisioning <em className="font-newsreader font-normal italic">hit a snag.</em>
    </>
  ) : (
    <>
      Spinning up{' '}
      <em className="font-newsreader font-normal italic">your brain.</em>
    </>
  );

  const subline = failed
    ? 'We couldn\u2019t finish setting up your private runtime. Your data is safe — retry below.'
    : overdue
      ? 'Taking a little longer than usual. Hold tight — you can keep this tab open or come back later.'
      : 'We\u2019re building you a private runtime. This usually takes 30\u201360 seconds. You can leave this tab open or check back in a minute.';

  const onRetry = useCallback(async () => {
    if (retrying) return;
    setRetrying(true);
    setRetryError(null);
    try {
      const response = await fetch('/api/workspaces/onboarding/retry-provision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
      });
      if (!response.ok && response.status !== 202) {
        const payload = await response.json().catch(() => ({}));
        setRetryError(payload.error ?? 'retry_failed');
        setRetrying(false);
        return;
      }
      await mutate();
      setRetrying(false);
    } catch {
      setRetryError('network_error');
      setRetrying(false);
    }
  }, [retrying, mutate]);

  return (
    <motion.div
      key="provisioning"
      initial={{ opacity: 0, y: 4 }}
      animate={{
        opacity: 1,
        y: 0,
        transition: { duration: 0.2, ease: EASE_STANDARD },
      }}
    >
      <p className="font-mono text-[11px] uppercase tracking-[0.06em] text-text-subtle">
        {failed ? 'PROVISIONING FAILED' : overdue ? 'STILL WORKING' : 'PROVISIONING'}
      </p>
      <h1 className="mt-3 text-[38px] font-medium leading-[1.06] tracking-[-0.025em] text-text-primary">
        {headline}
      </h1>
      <p className="mt-3.5 max-w-[42ch] text-sm leading-body text-text-body">{subline}</p>

      <div className="mt-7 max-w-[460px] rounded-2xl border border-[#e5e5e5] bg-white p-[18px_22px]">
        <div className="flex items-center gap-2.5">
          <span
            className={`h-[7px] w-[7px] rounded-full ${
              failed ? 'bg-destructive' : 'bg-accent'
            }`}
            style={
              failed
                ? undefined
                : { animation: 'pulse 1.6s ease-in-out infinite' }
            }
            aria-hidden="true"
          />
          <span className="text-sm font-medium text-text-primary">
            {failed
              ? 'Runtime failed'
              : overdue
                ? 'Almost there\u2026'
                : 'Provisioning runtime\u2026'}
          </span>
        </div>
        <div className="relative mt-4 h-1.5 overflow-hidden rounded-full bg-accent-soft">
          {failed ? (
            <div className="absolute inset-0 bg-destructive/30" aria-hidden="true" />
          ) : (
            <>
              <div
                className="h-full rounded-full bg-accent"
                style={{ width: '100%' }}
                aria-hidden="true"
              />
              <div
                className="pointer-events-none absolute left-0 top-0 h-full w-[60px] bg-gradient-to-r from-transparent via-white/65 to-transparent"
                style={{ animation: 'shimmer 1.6s linear infinite' }}
                aria-hidden="true"
              />
            </>
          )}
        </div>
      </div>

      {failed || overdue ? (
        <div className="mt-6 flex items-center gap-3">
          <button
            type="button"
            onClick={() => void onRetry()}
            disabled={retrying}
            className={
              failed
                ? 'inline-flex h-11 items-center justify-center rounded-xl bg-accent px-5 text-[15px] font-medium tracking-[-0.01em] text-white transition-[filter,transform] duration-140 hover:brightness-110 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60'
                : 'inline-flex h-11 items-center justify-center rounded-xl border border-input bg-white px-5 text-[14px] font-medium tracking-[-0.01em] text-text-primary transition-[border-color,background-color] duration-140 hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-60'
            }
          >
            {retrying
              ? 'Retrying\u2026'
              : failed
                ? 'Retry provisioning'
                : 'Restart provisioning'}
          </button>
          {retryError ? (
            <span role="alert" className="text-[13px] font-medium text-destructive">
              {humanizeError(retryError)}
            </span>
          ) : null}
        </div>
      ) : null}
    </motion.div>
  );
}

function csrfHeaders(): HeadersInit {
  if (typeof document === 'undefined') return {};
  const csrf = document.cookie
    .split('; ')
    .find((part) => part.startsWith('open42_csrf='))
    ?.split('=')[1];
  return csrf ? { 'X-CSRF-Token': csrf } : {};
}

function humanizeError(code: string): string {
  switch (code) {
    case 'workspace_name_invalid':
      return 'That workspace name isn\u2019t valid. 80 characters max.';
    case 'invite_emails_invalid':
      return 'One or more email addresses look off. Check the list and try again.';
    case 'unauthorized':
      return 'Your session expired. Sign in again.';
    case 'network_error':
      return 'Couldn\u2019t reach the server. Check your connection and try again.';
    default:
      return 'Something went wrong. Try again.';
  }
}
