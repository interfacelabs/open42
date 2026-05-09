import Head from 'next/head';
import { useRouter } from 'next/router';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';
import useSWR from 'swr';

import { Sidebar } from '@/components/Sidebar';
import { Button } from '@/components/ui/button';

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

function csrfHeaders(): HeadersInit {
  if (typeof document === 'undefined') return {};
  const csrf = document.cookie
    .split('; ')
    .find((part) => part.startsWith('open42_csrf='))
    ?.split('=')[1];
  return csrf ? { 'X-CSRF-Token': csrf } : {};
}

export default function ApiKeysSettingsPage() {
  const router = useRouter();
  const { data, error, mutate } = useSWR<CredentialsPayload>(
    '/api/workspaces/credentials',
    fetcher,
  );

  useEffect(() => {
    if (error && (error as { status?: number }).status === 401) {
      void router.replace('/sign_in');
    }
  }, [error, router]);

  const credentials = data?.credentials ?? [];

  return (
    <>
      <Head>
        <title>API Keys - Open42</title>
      </Head>
      <main className="flex min-h-screen bg-background">
        <Sidebar />
        <div className="flex-1 px-10 py-10">
          <div className="max-w-3xl">
            <header>
              <p className="font-mono text-xs text-text-subtle">SETTINGS</p>
              <h1 className="mt-4 text-4xl font-medium leading-headline tracking-tight text-text-primary md:text-5xl">
                API keys
              </h1>
              <p className="mt-3 max-w-[58ch] text-sm leading-body text-text-body">
                Bring your own provider keys. When set, this workspace bills
                LLM and embedding calls to your account instead of the shared
                Open42 key.
              </p>
            </header>

            <section className="mt-10">
              <h2 className="text-sm font-medium uppercase tracking-[0.04em] text-text-subtle">
                Configured keys
              </h2>
              <CredentialsList
                credentials={credentials}
                onRemoved={() => mutate()}
              />
            </section>

            <section className="mt-12">
              <h2 className="text-sm font-medium uppercase tracking-[0.04em] text-text-subtle">
                Add a key
              </h2>
              <AddKeyForm onSaved={() => mutate()} />
            </section>
          </div>
        </div>
      </main>
    </>
  );
}

function CredentialsList({
  credentials,
  onRemoved,
}: {
  credentials: CredentialEntry[];
  onRemoved: () => void;
}) {
  if (credentials.length === 0) {
    return (
      <div className="mt-4 rounded-2xl border border-dashed border-border bg-white p-8 text-center">
        <p className="text-sm font-medium text-text-primary">No keys yet.</p>
        <p className="mt-2 text-sm text-text-subtle">
          Add your provider keys below to use your own account.
        </p>
      </div>
    );
  }

  return (
    <ul className="mt-4 space-y-3">
      {credentials.map((cred) => (
        <CredentialCard
          key={`${cred.provider}:${cred.scope}`}
          credential={cred}
          onRemoved={onRemoved}
        />
      ))}
    </ul>
  );
}

function CredentialCard({
  credential,
  onRemoved,
}: {
  credential: CredentialEntry;
  onRemoved: () => void;
}) {
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ariaLabel = `${PROVIDER_LABEL[credential.provider]} ${
    SCOPE_LABEL[credential.scope]
  } credential`;

  async function remove() {
    if (typeof window === 'undefined') return;
    const confirmed = window.confirm(
      'Remove this key? Your workspace will fall back to the shared Open42 key.',
    );
    if (!confirmed) return;
    setRemoving(true);
    setError(null);
    try {
      const res = await fetch('/api/workspaces/credentials', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
        body: JSON.stringify({
          provider: credential.provider,
          scope: credential.scope,
        }),
      });
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
        className="flex items-center justify-between rounded-2xl border border-border bg-white p-5"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-base font-medium text-text-primary">
              {PROVIDER_LABEL[credential.provider]}
            </p>
            <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.04em] text-text-subtle">
              {SCOPE_LABEL[credential.scope]}
            </span>
            <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.04em] text-emerald-700">
              Configured
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-text-subtle">
            {credential.model ? <span>model: {credential.model}</span> : null}
            <span>added {new Date(credential.createdAt).toLocaleDateString()}</span>
          </div>
          {error ? (
            <p className="mt-2 text-xs text-red-600">{error}</p>
          ) : null}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={remove}
          disabled={removing}
          aria-label={`Remove ${ariaLabel}`}
        >
          <Trash2 className="mr-2 h-4 w-4" strokeWidth={1.5} />
          {removing ? 'Removing...' : 'Remove'}
        </Button>
      </article>
    </li>
  );
}

function AddKeyForm({ onSaved }: { onSaved: () => void }) {
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

  const canSubmit = !submitting && !unsupported && apiKey.trim().length > 0;

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
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        provider,
        scope,
        apiKey: apiKey.trim(),
      };
      if (model.trim()) body.model = model.trim();
      const res = await fetch('/api/workspaces/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
        body: JSON.stringify(body),
      });
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
      // Reset form (do NOT keep the secret in memory).
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
      className="mt-4 space-y-5 rounded-2xl border border-border bg-white p-6"
      noValidate
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FieldLabel label="Provider">
          <select
            value={provider}
            onChange={(e) => {
              setProvider(e.target.value as Provider);
              setScopeError(null);
            }}
            className="h-10 w-full rounded-input border border-border bg-white px-3 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic</option>
          </select>
        </FieldLabel>

        <FieldLabel label="Scope">
          <select
            value={scope}
            onChange={(e) => {
              setScope(e.target.value as Scope);
              setScopeError(null);
            }}
            className="h-10 w-full rounded-input border border-border bg-white px-3 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="chat">Chat</option>
            <option value="embed">Embed</option>
          </select>
          {unsupported ? (
            <p className="mt-1 text-xs text-text-subtle">
              Anthropic doesn&rsquo;t expose an embeddings API. Pick OpenAI for
              embed.
            </p>
          ) : scopeError ? (
            <p className="mt-1 text-xs text-red-600">{scopeError}</p>
          ) : null}
        </FieldLabel>
      </div>

      <FieldLabel label="API key">
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={
            provider === 'openai' ? 'sk-...' : 'sk-ant-...'
          }
          className="h-10 w-full rounded-input border border-border bg-white px-3 font-mono text-sm text-text-primary placeholder:text-text-faint focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </FieldLabel>

      <FieldLabel
        label="Model override"
        hint="Optional. Defaults to the workspace's selected model."
      >
        <input
          type="text"
          autoComplete="off"
          spellCheck={false}
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder={
            scope === 'embed' ? 'text-embedding-3-large' : 'gpt-4o-mini'
          }
          className="h-10 w-full rounded-input border border-border bg-white px-3 font-mono text-sm text-text-primary placeholder:text-text-faint focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </FieldLabel>

      {formError ? (
        <p className="text-sm text-red-600" role="alert">
          {formError}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={!canSubmit} size="sm">
          {submitting ? 'Saving...' : 'Save'}
        </Button>
        {/*
          TODO(BYOK): wire a Test button once Lane E3 ships a `?dry_run=1`
          variant of POST /workspaces/credentials. Skipped in v1 to avoid a
          coordination roundtrip — invalid keys will surface on the next
          real LLM call.
        */}
        {savedFlash ? (
          <span className="text-xs font-medium text-emerald-700">Saved</span>
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
      <span className="text-xs font-medium uppercase tracking-[0.04em] text-text-subtle">
        {label}
      </span>
      <div className="mt-1.5">{children}</div>
      {hint ? (
        <span className="mt-1 block text-xs text-text-subtle">{hint}</span>
      ) : null}
    </label>
  );
}
