import Head from 'next/head';
import { useRouter } from 'next/router';
import {
  FormEvent,
  Fragment,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { motion } from 'motion/react';
import useSWR from 'swr';

import { ConnectSourcesStep } from '@/components/onboarding/ConnectSourcesStep';
import { EditorialPane } from '@/components/onboarding/EditorialPane';
import { EnvelopeStage } from '@/components/onboarding/EnvelopeStage';
import { Nameplate } from '@/components/onboarding/Nameplate';
import { BrainSpinUp } from '@/components/onboarding/illustrations/BrainSpinUp';
import { PaperBoats } from '@/components/onboarding/illustrations/PaperBoats';
import { csrfHeaders } from '@/lib/csrf';
import { isValidInviteEmail, parseInviteEmails } from '@/lib/email-parser';
import {
  CurrentPayload,
  OnboardMode,
  OnboardStep,
  WorkspaceRuntime,
  deriveOnboardStep,
} from '@/lib/onboarding/derive';
import { EASE_STANDARD } from '@/lib/motion';
import {
  useWorkspaceStore,
  type WorkspaceSummary,
} from '@/lib/workspaces/store';

interface OnboardCurrentPayload extends CurrentPayload {
  workspace: { id: string; name: string; runtime: WorkspaceRuntime } | null;
  invites: Array<{ id: string; email: string; status: string }>;
  user: { id: string; email: string };
  requiresProviderKeys?: boolean;
  providerKeys?: {
    anthropicChat: boolean;
    openaiEmbed: boolean;
  };
}

/**
 * Codex round-6 P2: when the user reloads (or navigates back) mid-provisioning
 * during the mode=create flow, the React-only `createdWorkspaceId` state
 * resets to null and the polling effect stops watching for the new
 * workspace — the page hangs on the spinner forever. Persisting the id to
 * sessionStorage (per-tab, cleared on tab close) survives a reload while
 * still scoping recovery to the same browser tab.
 */
const CREATE_PENDING_KEY = 'open42:create_pending_workspace_id';

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) {
    const err = new Error('fetch_failed') as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return res.json();
};

function deriveOnboardRefreshStep(
  current: OnboardCurrentPayload | undefined,
  urlStep: string | null,
  mode: OnboardMode,
): OnboardStep | null {
  if (current) return deriveOnboardStep(current, urlStep, mode);
  return mode === 'create' ? 'workspace' : null;
}

export default function OnboardPage() {
  const router = useRouter();
  const urlStep = typeof router.query.step === 'string' ? router.query.step : null;
  const mode: OnboardMode = router.query.mode === 'create' ? 'create' : 'first';
  const { data: current, error, mutate, isLoading, isValidating } = useSWR<OnboardCurrentPayload>(
    '/api/workspaces/current',
    fetcher,
    {
      refreshInterval: (latest) =>
        deriveOnboardRefreshStep(latest, urlStep, mode) === 'provisioning' ? 1500 : 0,
    },
  );

  // Lifted so the editorial pane reacts live to the form as the user types.
  const [workspaceName, setWorkspaceName] = useState<string>('');
  const seededFromServerRef = useRef(false);
  const [inviteText, setInviteText] = useState<string>('');
  // mode=create: id of the workspace we just POST'd /api/workspaces for. We
  // poll /api/workspaces (the list endpoint) for THIS workspace's status —
  // /api/workspaces/current can't be used because POST /workspaces does not
  // change users.current_workspace_id on the server, so /current keeps
  // returning the OLD workspace forever and our previous condition never
  // fired (users got stuck on the provisioning step).
  //
  // Initialise from sessionStorage so a reload during provisioning doesn't
  // strand the user on the spinner (round-6 P2). Cleared once the create
  // flow resolves (ready → home, or failed → switched + retry UI).
  const [createdWorkspaceId, setCreatedWorkspaceIdState] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return window.sessionStorage.getItem(CREATE_PENDING_KEY);
  });
  // Wrapper that mirrors the React state into sessionStorage so a reload
  // mid-provisioning can pick up where we left off. We deliberately don't
  // useEffect this: the setter is the only call site, so wrapping it keeps
  // the side-effect adjacent to the state update and avoids double-writes.
  const setCreatedWorkspaceId = useCallback((id: string) => {
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(CREATE_PENDING_KEY, id);
    }
    setCreatedWorkspaceIdState(id);
  }, []);

  // List poll — only active in create mode after submit. We surface
  // `workspaces` (full list) so the redirect effect can locate the new row
  // by id and read its `status`.
  const { data: wsList } = useSWR<{ workspaces: WorkspaceSummary[] }>(
    mode === 'create' && createdWorkspaceId ? '/api/workspaces' : null,
    fetcher,
    { refreshInterval: 1500 },
  );

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
  // In create mode the existing workspace name should NOT pre-fill the form —
  // the user is creating a brand-new workspace.
  useEffect(() => {
    if (mode === 'create') return;
    if (!seededFromServerRef.current && current?.workspace?.name) {
      seededFromServerRef.current = true;
      queueMicrotask(() => setWorkspaceName(current.workspace!.name));
    }
  }, [current, mode]);

  // In create mode, while SWR is still loading we should still show the
  // workspace-name step (the user has no need to wait on /workspaces/current
  // — they're creating a new one). Once `current` lands we re-derive normally.
  const step: OnboardStep | null = current
    ? deriveOnboardStep(current, urlStep, mode)
    : mode === 'create'
      ? 'workspace'
      : null;
  const topbarWorkspaceName = current?.workspace?.name ?? '';

  const inviteLines = useMemo(() => parseInviteEmails(inviteText), [inviteText]);

  // First-time (mode='first') flow: when the runtime flips ready on the
  // provisioning step, hand off to the connect step. When derive returns
  // null (workspace ready + at least one connection), hand off home.
  const runtime = current?.workspace?.runtime;
  useEffect(() => {
    if (mode === 'create') return;
    if (!current) return;
    if (step === 'provisioning' && runtime === 'ready') {
      const hasProviderKeys =
        !current.requiresProviderKeys ||
        (current.providerKeys?.anthropicChat && current.providerKeys?.openaiEmbed);
      void router.replace(hasProviderKeys ? '/onboard?step=connect' : '/onboard?step=keys');
      return;
    }
    if (step === null) {
      void router.replace('/');
    }
  }, [current, step, runtime, router, mode]);

  // mode='create' flow: poll /api/workspaces (the list) for the new
  // workspace and, once *its* status flips to 'ready', switch + redirect.
  // Using the list endpoint avoids /workspaces/current's staleness — the
  // server never updates current_workspace_id from POST /workspaces, so
  // the previous condition (current.workspace?.id === newId) could never
  // become true and users were stranded on the provisioning step.
  //
  // If the new workspace flips to 'failed' instead, switch into it so the
  // ProvisioningStep (which reads current.workspace.runtime from
  // /api/workspaces/current) renders its failure/retry UI for the new
  // workspace. /workspaces/current already honors current_workspace_id
  // (round-2 fix), so the failure surface "just works" after the switch.
  useEffect(() => {
    if (mode !== 'create') return;
    if (!createdWorkspaceId) return;
    const newWs = wsList?.workspaces?.find((w) => w.id === createdWorkspaceId);
    if (!newWs) return;
    if (newWs.status === 'ready') {
      void (async () => {
        try {
          await useWorkspaceStore.getState().switchTo(createdWorkspaceId);
        } catch {
          // best-effort; the refresh below reconciles store state regardless
        }
        await useWorkspaceStore.getState().refresh();
        // Resolution reached — clear the per-tab create marker so a future
        // visit to /auth/onboard?mode=create doesn't re-read a stale id.
        if (typeof window !== 'undefined') {
          window.sessionStorage.removeItem(CREATE_PENDING_KEY);
        }
        void router.replace('/');
      })();
      return;
    }
    if (newWs.status === 'failed') {
      // Switch into the failed workspace + remutate /workspaces/current so
      // the ProvisioningStep we're already on re-renders against the new
      // workspace's runtime ('failed' → retry button). No redirect — the
      // user stays on the provisioning step until they retry. Also clear
      // the per-tab create marker: the failure UI's retry path goes through
      // /workspaces/onboarding/retry-provision against the current
      // workspace, so this polling effect's job is done. Keeping the
      // stashed id would let a successful retry re-read it on the next
      // mount and re-arm the list poll for an already-resolved workspace.
      if (typeof window !== 'undefined') {
        window.sessionStorage.removeItem(CREATE_PENDING_KEY);
      }
      void (async () => {
        try {
          await useWorkspaceStore.getState().switchTo(createdWorkspaceId);
        } catch {
          // best-effort; the mutate below still pulls the new current
        }
        await mutate();
      })();
    }
  }, [mode, createdWorkspaceId, wsList, router, mutate]);

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
                {mode === 'create' && step === 'workspace' ? (
                  // In create mode the workspace-name step renders even before
                  // SWR settles — the user is creating a new workspace and
                  // doesn't need any state from /workspaces/current to start.
                  <WorkspaceStep
                    name={workspaceName}
                    setName={setWorkspaceName}
                    mutate={mutate}
                    mode={mode}
                    onCreated={setCreatedWorkspaceId}
                  />
                ) : isLoading || !current ? (
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
                    mode={mode}
                    onCreated={setCreatedWorkspaceId}
                  />
                ) : step === 'provisioning' ? (
                  <ProvisioningStep current={current} mutate={mutate} />
                ) : step === 'keys' ? (
                  <ProviderKeysStep current={current} mutate={mutate} />
                ) : step === 'connect' ? (
                  <ConnectSourcesStep
                    runtime={current.workspace?.runtime ?? 'provisioning'}
                    workspaceId={current.workspace?.id ?? null}
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
              illustration={<EnvelopeStage lines={inviteLines} isValid={isValidInviteEmail} />}
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
          ) : step === 'keys' ? (
            <EditorialPane
              quote={
                <>
                  Your brain should use
                  <br />
                  <em>your keys.</em>
                </>
              }
              attribution="— OPEN42 OPERATING PRINCIPLE №4"
              illustration={<PaperBoats />}
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
  const dots: DotState[] = useMemo(() => {
    if (step === 'workspace') return ['active', 'pending', 'pending', 'pending', 'pending'];
    if (step === 'invite') return ['done', 'active', 'pending', 'pending', 'pending'];
    if (step === 'provisioning') return ['done', 'done', 'active', 'pending', 'pending'];
    if (step === 'keys') return ['done', 'done', 'done', 'active', 'pending'];
    if (step === 'connect') return ['done', 'done', 'done', 'done', 'active'];
    return ['pending', 'pending', 'pending', 'pending', 'pending'];
  }, [step]);

  const label =
    step === 'workspace'
      ? 'Workspace'
      : step === 'invite'
        ? 'Invite'
        : step === 'provisioning'
          ? 'Spinning up'
          : step === 'keys'
            ? 'API keys'
          : step === 'connect'
            ? 'Connect a source'
            : '';

  return (
    <div className="flex items-center gap-2.5 font-mono text-[11px] text-text-subtle">
      {label ? <span className="font-medium text-text-primary">{label}</span> : null}
      <div className="flex items-center gap-1.5" aria-label="onboarding progress">
        {dots.map((dot, index) => (
          <Fragment key={index}>
            {index > 0 ? <Connector state={lineState(dots[index - 1]!, dot)} /> : null}
            <Dot state={dot} />
          </Fragment>
        ))}
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
  mode,
  onCreated,
}: {
  name: string;
  setName: (value: string) => void;
  mutate: () => Promise<unknown>;
  mode: OnboardMode;
  onCreated: (id: string) => void;
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
        // In `mode='create'` we hit the new POST /api/workspaces endpoint
        // (Chunk 5) — it creates an additional workspace + owner membership
        // for the already-onboarded user. In the legacy first-time flow we
        // keep using the onboarding alias to preserve its specific semantics
        // (idempotent rename of the user's bootstrap workspace).
        const url =
          mode === 'create'
            ? '/api/workspaces'
            : '/api/workspaces/onboarding/workspace';
        const response = await fetch(url, {
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
        if (mode === 'create') {
          // Capture the new workspace id so the parent's effect can detect
          // when its runtime flips to 'ready' and route home.
          const payload = (await response.json().catch(() => ({}))) as {
            workspace?: { id?: string };
          };
          const newId = payload.workspace?.id;
          if (newId) onCreated(newId);
          await mutate();
          await router.replace('/onboard?mode=create&step=provisioning');
          return;
        }
        await mutate();
        await router.replace('/onboard?step=invite');
      } catch {
        setError('network_error');
        setSubmitting(false);
      }
    },
    [name, submitting, mutate, router, mode, onCreated],
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

function ProviderKeysStep({
  current,
  mutate,
}: {
  current: OnboardCurrentPayload;
  mutate: () => Promise<unknown>;
}) {
  const router = useRouter();
  const workspaceId = current.workspace?.id ?? null;
  const [anthropicKey, setAnthropicKey] = useState('');
  const [openaiKey, setOpenaiKey] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const providerKeys = current.providerKeys ?? { anthropicChat: false, openaiEmbed: false };
  const needsAnthropic = !providerKeys.anthropicChat;
  const needsOpenAI = !providerKeys.openaiEmbed;

  const submit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!workspaceId || submitting) return;
      if (needsAnthropic && !anthropicKey.trim()) {
        setError('anthropic_key_required');
        return;
      }
      if (needsOpenAI && !openaiKey.trim()) {
        setError('openai_key_required');
        return;
      }

      setSubmitting(true);
      setError(null);
      try {
        const writes = [
          needsAnthropic
            ? {
                provider: 'anthropic',
                scope: 'chat',
                apiKey: anthropicKey.trim(),
              }
            : null,
          needsOpenAI
            ? {
                provider: 'openai',
                scope: 'embed',
                apiKey: openaiKey.trim(),
              }
            : null,
        ].filter(Boolean) as Array<{
          provider: 'anthropic' | 'openai';
          scope: 'chat' | 'embed';
          apiKey: string;
        }>;

        for (const body of writes) {
          const response = await fetch(`/api/workspaces/${workspaceId}/credentials`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
            body: JSON.stringify(body),
          });
          if (!response.ok) {
            const payload = await response.json().catch(() => ({}));
            setError(payload.error ?? 'provider_key_failed');
            setSubmitting(false);
            return;
          }
        }
        await mutate();
        await router.replace('/onboard?step=connect');
      } catch {
        setError('network_error');
        setSubmitting(false);
      }
    },
    [
      anthropicKey,
      mutate,
      needsAnthropic,
      needsOpenAI,
      openaiKey,
      router,
      submitting,
      workspaceId,
    ],
  );

  return (
    <motion.div
      key="keys"
      initial={{ opacity: 0, y: 4 }}
      animate={{
        opacity: 1,
        y: 0,
        transition: { duration: 0.2, ease: EASE_STANDARD },
      }}
    >
      <h1 className="text-[38px] font-medium leading-[1.06] tracking-[-0.025em] text-text-primary">
        Add{' '}
        <em className="font-newsreader font-normal italic text-text-primary">
          provider keys.
        </em>
      </h1>
      <p className="mt-3.5 max-w-[46ch] text-sm leading-body text-text-body">
        Community edition is BYOK by default. Keys are encrypted before storage and never
        sent into the gbrain runtime.
      </p>
      <form onSubmit={submit} className="mt-7 space-y-5" noValidate>
        <ProviderKeyField
          id="anthropic-key"
          label="Anthropic chat key"
          value={anthropicKey}
          configured={!needsAnthropic}
          onChange={setAnthropicKey}
        />
        <ProviderKeyField
          id="openai-key"
          label="OpenAI embedding key"
          value={openaiKey}
          configured={!needsOpenAI}
          onChange={setOpenaiKey}
        />
        <button
          type="submit"
          disabled={submitting || !workspaceId}
          className="inline-flex h-11 items-center justify-center rounded-xl bg-accent px-6 text-[15px] font-medium tracking-[-0.01em] text-white transition-[filter,transform] duration-140 hover:brightness-110 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? 'Saving\u2026' : 'Continue \u2192'}
        </button>
        {error ? (
          <p role="alert" className="text-[13px] font-medium text-destructive">
            {humanizeError(error)}
          </p>
        ) : null}
      </form>
      <PulsingNote>gbrain will call providers through Open42&rsquo;s proxy.</PulsingNote>
    </motion.div>
  );
}

function ProviderKeyField({
  id,
  label,
  value,
  configured,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  configured: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-[13px] font-medium text-text-primary">
        {label}
      </label>
      <input
        id={id}
        type="password"
        autoComplete="off"
        value={value}
        disabled={configured}
        onChange={(event) => onChange(event.target.value)}
        placeholder={configured ? 'Already configured' : 'Paste key'}
        className="h-11 w-full rounded-input border border-input bg-white px-3.5 text-[15px] text-text-primary outline-none transition-[border-color,box-shadow] duration-140 focus:border-accent focus:shadow-[0_0_0_4px_rgba(29,77,255,0.10)] disabled:bg-panel-soft disabled:text-text-subtle"
      />
    </div>
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

  const validEmails = useMemo(() => lines.filter(isValidInviteEmail), [lines]);

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

  const workspaceId = current.workspace?.id ?? null;
  const onRetry = useCallback(async () => {
    if (retrying) return;
    if (!workspaceId) {
      // No workspace to retry against — shouldn't happen because the
      // provisioning step only renders when current.workspace exists, but
      // guard anyway so we don't fire a 400 against the API.
      setRetryError('retry_failed');
      return;
    }
    setRetrying(true);
    setRetryError(null);
    try {
      // Codex round-4 P2: retry endpoint now requires workspace_id in the
      // body (it used to LIMIT-1 over the user's owned workspaces). The
      // workspace id is known from `current` — the page already renders
      // this specific workspace's failed/overdue state.
      const response = await fetch('/api/workspaces/onboarding/retry-provision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
        body: JSON.stringify({ workspace_id: workspaceId }),
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
  }, [retrying, workspaceId, mutate]);

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

function humanizeError(code: string): string {
  switch (code) {
    case 'workspace_name_invalid':
      return 'That workspace name isn\u2019t valid. 80 characters max.';
    case 'invite_emails_invalid':
      return 'One or more email addresses look off. Check the list and try again.';
    case 'anthropic_key_required':
      return 'Add an Anthropic chat key to continue.';
    case 'openai_key_required':
      return 'Add an OpenAI embedding key to continue.';
    case 'invalid_api_key':
      return 'That provider key is not valid.';
    case 'unauthorized':
      return 'Your session expired. Sign in again.';
    case 'network_error':
      return 'Couldn\u2019t reach the server. Check your connection and try again.';
    default:
      return 'Something went wrong. Try again.';
  }
}
