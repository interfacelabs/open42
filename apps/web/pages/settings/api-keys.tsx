import Head from 'next/head';
import { useRouter } from 'next/router';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';
import useSWR from 'swr';

import { AppShell } from '@/components/AppShell';
import { PageHeader } from '@/components/PageHeader';
import { SettingsNav } from '@/components/SettingsNav';
import { Button } from '@/components/ui/button';
import { csrfHeaders } from '@/lib/csrf';
import { cn } from '@/lib/utils';
import { useWorkspaceStore } from '@/lib/workspaces/store';

type Provider = 'openai' | 'anthropic';
type Scope = 'chat' | 'embed';

interface CredentialEntry {
  provider: Provider;
  scope: Scope;
  model?: string | null;
  createdAt: string;
}

interface CredentialsPayload {
  credentials: CredentialEntry[];
}

const fetcher = async (url: string): Promise<CredentialsPayload> => {
  const res = await fetch(url);
  if (!res.ok) {
    const err = new Error('fetch_failed') as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return res.json();
};

const PROVIDER_LABEL: Record<Provider, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
};

const SCOPE_LABEL: Record<Scope, string> = {
  chat: 'Chat',
  embed: 'Embed',
};

function isUnsupportedCombo(provider: Provider, scope: Scope): boolean {
  return provider === 'anthropic' && scope === 'embed';
}

export default function ApiKeysSettingsPage() {
  const router = useRouter();
  // Workspace id comes from the Zustand store (which hydrates from
  // `/api/workspaces` + `/api/auth/me`). The credentials API is mounted under
  // `/workspaces/:id/credentials` so we have to thread the id through every
  // request — there is no "first owned" fallback any more.
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const credentialsUrl = workspaceId
    ? `/api/workspaces/${encodeURIComponent(workspaceId)}/credentials`
    : null;
  const { data, error, mutate } = useSWR<CredentialsPayload>(
    credentialsUrl,
    fetcher,
  );

  useEffect(() => {
    if (error && (error as { status?: number }).status === 401) {
      void router.replace('/sign_in');
    }
  }, [error, router]);

  const credentials = data?.credentials ?? [];
  const isForbidden = (error as { status?: number } | undefined)?.status === 403;

  return (
    <>
      <Head>
        <title>API keys — Open42</title>
      </Head>
      <AppShell>
        <PageHeader
          breadcrumb="SETTINGS · API KEYS"
          title="API keys"
          subtitle="Bring your own provider keys. When set, this workspace bills LLM and embedding calls to your account instead of the shared Open42 key."
        />
        <SettingsNav active="api-keys" />

        <div className="flex-1 overflow-auto px-5 py-8 md:px-10 md:py-10">
          <div className="max-w-3xl">
            {isForbidden ? (
              <div
                role="alert"
                className="rounded-xl border border-border bg-panel-soft px-5 py-4 text-[13.5px] text-text-body"
                data-testid="api-keys-forbidden"
              >
                Only workspace owners can manage API keys. Ask the owner of
                this workspace to add or rotate a provider key.
              </div>
            ) : (
              <>
                <section>
                  <SectionHeading>Configured keys</SectionHeading>
                  <CredentialsList
                    credentials={credentials}
                    workspaceId={workspaceId}
                    onRemoved={() => mutate()}
                  />
                </section>

                <section className="mt-12">
                  <SectionHeading>Add a key</SectionHeading>
                  <AddKeyForm workspaceId={workspaceId} onSaved={() => mutate()} />
                </section>
              </>
            )}
          </div>
        </div>
      </AppShell>
    </>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-text-faint">
      {children}
    </h2>
  );
}

function CredentialsList({
  credentials,
  workspaceId,
  onRemoved,
}: {
  credentials: CredentialEntry[];
  workspaceId: string | null;
  onRemoved: () => void;
}) {
  if (credentials.length === 0) {
    return (
      <div className="mt-3 rounded-xl border border-dashed border-border bg-white p-8 text-center">
        <p className="text-[14px] font-medium text-text-primary">
          No keys yet.
        </p>
        <p className="mt-1.5 text-[13px] text-text-subtle">
          Add your provider keys below to use your own account.
        </p>
      </div>
    );
  }

  return (
    <ul className="mt-3 space-y-3">
      {credentials.map((cred) => (
        <CredentialCard
          key={`${cred.provider}:${cred.scope}`}
          credential={cred}
          workspaceId={workspaceId}
          onRemoved={onRemoved}
        />
      ))}
    </ul>
  );
}

function CredentialCard({
  credential,
  workspaceId,
  onRemoved,
}: {
  credential: CredentialEntry;
  workspaceId: string | null;
  onRemoved: () => void;
}) {
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ariaLabel = `${PROVIDER_LABEL[credential.provider]} ${
    SCOPE_LABEL[credential.scope]
  } credential`;

  async function remove() {
    if (typeof window === 'undefined') return;
    if (!workspaceId) {
      setError('No active workspace.');
      return;
    }
    const confirmed = window.confirm(
      'Remove this key? Your workspace will fall back to the shared Open42 key.',
    );
    if (!confirmed) return;
    setRemoving(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceId)}/credentials`,
        {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
          body: JSON.stringify({
            provider: credential.provider,
            scope: credential.scope,
          }),
        },
      );
      if (!res.ok) {
        setError('Failed to remove. Try again.');
        setRemoving(false);
        return;
      }
      onRemoved();
    } catch {
      setError('Network error. Try again.');
      setRemoving(false);
    }
  }

  return (
    <li>
      <article
        role="region"
        aria-label={ariaLabel}
        className="flex items-center justify-between rounded-xl border border-border-soft bg-white p-5"
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[14px] font-medium text-text-primary">
              {PROVIDER_LABEL[credential.provider]}
            </p>
            <Tag tone="neutral">{SCOPE_LABEL[credential.scope]}</Tag>
            <Tag tone="success">Configured</Tag>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-text-subtle">
            {credential.model ? <span>model: {credential.model}</span> : null}
            <span>added {new Date(credential.createdAt).toLocaleDateString()}</span>
          </div>
          {error ? (
            <p className="mt-2 text-[12px] text-destructive">{error}</p>
          ) : null}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={remove}
          disabled={removing}
          aria-label={`Remove ${ariaLabel}`}
        >
          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.6} />
          {removing ? 'Removing…' : 'Remove'}
        </Button>
      </article>
    </li>
  );
}

function Tag({
  tone,
  children,
}: {
  tone: 'neutral' | 'success' | 'warn';
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.06em]',
        tone === 'neutral' && 'bg-panel-soft text-text-subtle',
        tone === 'success' && 'bg-blue-soft text-blue',
        tone === 'warn' && 'bg-orange-soft text-orange',
      )}
    >
      {children}
    </span>
  );
}

function AddKeyForm({
  workspaceId,
  onSaved,
}: {
  workspaceId: string | null;
  onSaved: () => void;
}) {
  const [provider, setProvider] = useState<Provider>('openai');
  const [scope, setScope] = useState<Scope>('chat');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [scopeError, setScopeError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  const unsupported = useMemo(
    () => isUnsupportedCombo(provider, scope),
    [provider, scope],
  );

  const canSubmit =
    !submitting && !unsupported && apiKey.trim().length > 0 && !!workspaceId;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setScopeError(null);
    if (unsupported) {
      setScopeError("Anthropic doesn't expose an embeddings API.");
      return;
    }
    if (!apiKey.trim()) {
      setFormError('API key is required.');
      return;
    }
    if (!workspaceId) {
      setFormError('No active workspace.');
      return;
    }
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        provider,
        scope,
        apiKey: apiKey.trim(),
      };
      if (model.trim()) body.model = model.trim();
      const res = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceId)}/credentials`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
          body: JSON.stringify(body),
        },
      );
      const payload = (await res.json().catch(() => ({}))) as {
        error?: string;
        detail?: string;
      };
      if (!res.ok) {
        if (payload.error === 'unsupported_provider_scope') {
          setScopeError(
            payload.detail === 'anthropic_has_no_embedding_api'
              ? "Anthropic doesn't expose an embeddings API."
              : 'Unsupported provider + scope combination.',
          );
        } else if (payload.error === 'invalid_input') {
          setFormError('Invalid input. Check the key shape.');
        } else if (res.status === 401) {
          setFormError('Sign in required.');
        } else if (res.status === 403) {
          setFormError('Only workspace owners can manage API keys.');
        } else {
          setFormError('Could not save the key. Try again.');
        }
        setSubmitting(false);
        return;
      }
      setApiKey('');
      setModel('');
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 2000);
      onSaved();
    } catch {
      setFormError('Network error. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="mt-3 space-y-5 rounded-xl border border-border-soft bg-white p-6"
      noValidate
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FieldLabel label="Provider">
          <Select
            value={provider}
            onChange={(value) => {
              setProvider(value as Provider);
              setScopeError(null);
            }}
            options={[
              { value: 'openai', label: 'OpenAI' },
              { value: 'anthropic', label: 'Anthropic' },
            ]}
          />
        </FieldLabel>

        <FieldLabel label="Scope">
          <Select
            value={scope}
            onChange={(value) => {
              setScope(value as Scope);
              setScopeError(null);
            }}
            options={[
              { value: 'chat', label: 'Chat' },
              { value: 'embed', label: 'Embed' },
            ]}
          />
          {unsupported ? (
            <p className="mt-1.5 text-[11.5px] text-text-subtle">
              Anthropic doesn&rsquo;t expose an embeddings API. Pick OpenAI for
              embed.
            </p>
          ) : scopeError ? (
            <p className="mt-1.5 text-[11.5px] text-destructive">{scopeError}</p>
          ) : null}
        </FieldLabel>
      </div>

      <FieldLabel label="API key">
        <Input
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={provider === 'openai' ? 'sk-…' : 'sk-ant-…'}
          mono
        />
      </FieldLabel>

      <FieldLabel
        label="Model override"
        hint="Optional. Defaults to the workspace's selected model."
      >
        <Input
          type="text"
          autoComplete="off"
          spellCheck={false}
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder={
            scope === 'embed' ? 'text-embedding-3-large' : 'gpt-4o-mini'
          }
          mono
        />
      </FieldLabel>

      {formError ? (
        <p className="text-[13px] text-destructive" role="alert">
          {formError}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={!canSubmit} size="sm">
          {submitting ? 'Saving…' : 'Save'}
        </Button>
        {savedFlash ? (
          <span className="text-[12px] font-medium text-blue">Saved</span>
        ) : null}
      </div>
    </form>
  );
}

function FieldLabel({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-text-faint">
        {label}
      </span>
      <div className="mt-1.5">{children}</div>
      {hint ? (
        <span className="mt-1.5 block text-[11.5px] text-text-subtle">
          {hint}
        </span>
      ) : null}
    </label>
  );
}

function Input({
  mono,
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { mono?: boolean }) {
  return (
    <input
      {...props}
      className={cn(
        'h-10 w-full rounded-lg border border-border bg-white px-3 text-[14px] text-text-primary placeholder:text-text-faint focus:border-blue-line focus:outline-none focus:ring-[3px] focus:ring-blue-soft',
        mono && 'font-mono text-[13px]',
        className,
      )}
    />
  );
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-10 w-full rounded-lg border border-border bg-white px-3 text-[14px] text-text-primary focus:border-blue-line focus:outline-none focus:ring-[3px] focus:ring-blue-soft"
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}
