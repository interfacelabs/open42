import Head from 'next/head';
import { ChangeEvent, FormEvent, useMemo, useState } from 'react';
import { FileArchive, PlugZap, Trash2, X } from 'lucide-react';
import useSWR from 'swr';

import { AppShell } from '@/components/AppShell';
import { PageHeader } from '@/components/PageHeader';
import { SettingsNav } from '@/components/SettingsNav';
import { Button } from '@/components/ui/button';
import { fetcher as apiFetcher, type FetchError } from '@/lib/api';
import {
  activeConnectorProfiles,
  authProfileIdForRequest,
  connectorProfilesForService,
  type ConnectorAuthProfile,
  type ConnectorAuthProfilesPayload,
  profileModeLabel,
  profileSupportsService,
} from '@/lib/connector-auth-profiles';
import { csrfHeaders } from '@/lib/csrf';
import { providerLogo } from '@/lib/provider-logos';
import { cn } from '@/lib/utils';
import { useWorkspaceStore } from '@/lib/workspaces/store';

interface Connection {
  id: string;
  kind: string;
  status: string;
}

interface ConnectionsPayload {
  connections: Connection[];
  composioEnabled?: boolean;
  composioServices?: ComposioService[];
}

type ComposioServiceStatus = 'available' | 'planned' | 'hidden';

interface ComposioService {
  serviceId: 'notion' | 'slack' | 'gdocs' | string;
  label: string;
  detail: string;
  connectionKind: string;
  logoSlug: string;
  status: ComposioServiceStatus;
  connectable: boolean;
}

const DEFAULT_COMPOSIO_SERVICES: ComposioService[] = [
  {
    serviceId: 'notion',
    label: 'Notion',
    detail: 'Live pages via OAuth',
    connectionKind: 'notion-composio',
    logoSlug: 'notion',
    status: 'available',
    connectable: false,
  },
  {
    serviceId: 'slack',
    label: 'Slack',
    detail: 'Channels, messages, and threads',
    connectionKind: 'slack-composio',
    logoSlug: 'slack',
    status: 'planned',
    connectable: false,
  },
  {
    serviceId: 'gdocs',
    label: 'Google Docs',
    detail: 'Docs and text content',
    connectionKind: 'gdocs-composio',
    logoSlug: 'googledocs',
    status: 'planned',
    connectable: false,
  },
];

export default function AddConnectionPage() {
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { data } = useSWR<ConnectionsPayload>(
    workspaceId ? `/api/workspaces/${workspaceId}/connections` : null,
    apiFetcher,
  );
  const {
    data: profilesData,
    error: profilesError,
    mutate: mutateProfiles,
  } = useSWR<ConnectorAuthProfilesPayload>(
    workspaceId ? `/api/workspaces/${workspaceId}/connector-auth-profiles` : null,
    apiFetcher,
    { shouldRetryOnError: false },
  );
  const [modalOpen, setModalOpen] = useState(false);
  const [uploadState, setUploadState] = useState<'idle' | 'uploading' | 'done' | 'error'>('idle');
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [byokLabel, setByokLabel] = useState('My Composio account');
  const [byokApiKey, setByokApiKey] = useState('');
  const [byokNotionAuthConfigId, setByokNotionAuthConfigId] = useState('');
  const [byokSaveState, setByokSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletingProfileId, setDeletingProfileId] = useState<string | null>(null);
  const hasNotion = Boolean(
    data?.connections.some(
      (connection) => connection.kind.startsWith('notion-') && connection.status !== 'disconnected',
    ),
  );

  const composioServices = data?.composioServices?.length
    ? data.composioServices
    : DEFAULT_COMPOSIO_SERVICES;
  const connectorProfiles = useMemo(
    () => activeConnectorProfiles(profilesData?.profiles),
    [profilesData?.profiles],
  );
  const notionProfiles = useMemo(
    () => connectorProfilesForService(connectorProfiles, 'notion'),
    [connectorProfiles],
  );
  const effectiveProfileId = selectedProfileId ?? notionProfiles[0]?.id ?? null;
  const effectiveProfile = notionProfiles.find((profile) => profile.id === effectiveProfileId);
  const profilesForbidden = (profilesError as FetchError | undefined)?.status === 403;
  const profilesFailed = Boolean(profilesError && !profilesForbidden);
  const notionCatalogConnectable = Boolean(
    composioServices.find((service) => service.serviceId === 'notion')?.connectable,
  );
  const notionLiveConnectable = profilesData?.profiles
    ? notionProfiles.length > 0
    : notionCatalogConnectable;

  async function connectOAuth(kind = 'notion-composio') {
    if (!workspaceId) return;
    const authProfileId = authProfileIdForRequest(effectiveProfileId);
    const response = await fetch(`/api/workspaces/${workspaceId}/connections/init`, {
      method: 'POST',
      headers: { ...csrfHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, serviceId: 'notion', authProfileId }),
    });
    const payload = await response.json();
    if (response.ok && payload.redirect_url) {
      window.location.href = payload.redirect_url;
    }
  }

  async function uploadZip(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !workspaceId) return;
    setUploadState('uploading');
    const form = new FormData();
    form.set('file', file);
    const response = await fetch(`/api/workspaces/${workspaceId}/connections/notion-zip`, {
      method: 'POST',
      headers: csrfHeaders(),
      body: form,
    });
    setUploadState(response.ok ? 'done' : 'error');
  }

  async function saveByokProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspaceId || byokSaveState === 'saving') return;
    setByokSaveState('saving');
    const response = await fetch(`/api/workspaces/${workspaceId}/connector-auth-profiles`, {
      method: 'POST',
      headers: { ...csrfHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        label: byokLabel.trim() || 'My Composio account',
        apiKey: byokApiKey.trim(),
        notionAuthConfigId: byokNotionAuthConfigId.trim(),
      }),
    });
    if (!response.ok) {
      setByokSaveState('error');
      return;
    }
    const payload = await response.json().catch(() => ({}));
    setByokApiKey('');
    setByokNotionAuthConfigId('');
    setByokSaveState('saved');
    await mutateProfiles();
    if (typeof payload.profileId === 'string') setSelectedProfileId(payload.profileId);
  }

  async function deleteByokProfile(profile: ConnectorAuthProfile) {
    if (!workspaceId || profile.mode !== 'byok' || deletingProfileId) return;
    const confirmed =
      typeof window === 'undefined' ||
      window.confirm(
        'Remove this Composio profile? Existing live connections that use it will stop syncing until reconnected.',
      );
    if (!confirmed) return;
    setDeletingProfileId(profile.id);
    setDeleteError(null);
    const response = await fetch(
      `/api/workspaces/${workspaceId}/connector-auth-profiles/${encodeURIComponent(profile.id)}`,
      {
        method: 'DELETE',
        headers: csrfHeaders(),
      },
    ).catch(() => null);
    if (!response?.ok) {
      setDeleteError('Could not remove this profile. Try again.');
      setDeletingProfileId(null);
      return;
    }
    if (selectedProfileId === profile.id) setSelectedProfileId(null);
    await mutateProfiles();
    setDeletingProfileId(null);
  }

  return (
    <>
      <Head>
        <title>Add connection — Open42</title>
      </Head>
      <AppShell>
        <PageHeader
          breadcrumb="SETTINGS · CONNECTIONS · ADD"
          title="Add a connection"
          subtitle={
            <>
              Pick a source the brain should read.{' '}
              <span className="font-serif italic">It can wait.</span>
            </>
          }
        />
        <SettingsNav active="connections" />

        <div className="flex-1 overflow-auto px-5 py-8 md:px-10 md:py-10">
          <div className="max-w-4xl">
            {hasNotion ? (
              <div className="mb-6 rounded-xl border border-orange/30 bg-orange-soft px-5 py-4 text-[13px] text-text-body">
                Notion is already connected. Disconnect it before switching ingestion methods.
              </div>
            ) : null}

            <section className="grid gap-3 sm:grid-cols-2">
              {composioServices.map((service) => (
                <ProviderTile
                  key={service.serviceId}
                  name={service.label}
                  detail={
                    service.serviceId === 'notion' ? 'Live OAuth or zip import' : service.detail
                  }
                  slug={service.logoSlug}
                  disabled={service.serviceId === 'notion' ? hasNotion : true}
                  comingSoon={service.status === 'planned'}
                  onClick={service.serviceId === 'notion' ? () => setModalOpen(true) : undefined}
                />
              ))}
            </section>

            <section className="mt-8 border-t border-border-soft pt-7">
              <div className="flex flex-col gap-1">
                <p className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-text-faint">
                  COMPOSIO ACCESS
                </p>
                <h2 className="text-[16px] font-medium text-text-primary">Connection profile</h2>
                <p className="max-w-2xl text-[13px] leading-body text-text-subtle">
                  Choose the Composio account Open42 should use when it creates new live
                  connections. Existing connections keep the profile they were created with.
                </p>
              </div>
              <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
                <ProfileList
                  profiles={connectorProfiles}
                  selectedProfileId={effectiveProfileId}
                  loading={!profilesData && !profilesError && Boolean(workspaceId)}
                  profilesForbidden={profilesForbidden}
                  profilesFailed={profilesFailed}
                  deletingProfileId={deletingProfileId}
                  deleteError={deleteError}
                  onSelect={setSelectedProfileId}
                  onDelete={(profile) => void deleteByokProfile(profile)}
                />
                <ByokProfileForm
                  label={byokLabel}
                  apiKey={byokApiKey}
                  notionAuthConfigId={byokNotionAuthConfigId}
                  saveState={byokSaveState}
                  disabled={!workspaceId || profilesForbidden}
                  onLabelChange={(value) => {
                    setByokLabel(value);
                    setByokSaveState('idle');
                  }}
                  onApiKeyChange={(value) => {
                    setByokApiKey(value);
                    setByokSaveState('idle');
                  }}
                  onNotionAuthConfigIdChange={(value) => {
                    setByokNotionAuthConfigId(value);
                    setByokSaveState('idle');
                  }}
                  onSubmit={saveByokProfile}
                />
              </div>
            </section>
          </div>
        </div>

        {modalOpen ? (
          <NotionModal
            onClose={() => setModalOpen(false)}
            onOAuth={() => void connectOAuth('notion-composio')}
            composioEnabled={notionLiveConnectable}
            profileLabel={effectiveProfile?.label ?? 'Open42 managed Composio'}
            uploadState={uploadState}
            onUpload={uploadZip}
          />
        ) : null}
      </AppShell>
    </>
  );
}

function ProviderTile({
  name,
  detail,
  slug,
  disabled,
  comingSoon,
  onClick,
}: {
  name: string;
  detail: string;
  slug: string;
  disabled?: boolean;
  comingSoon?: boolean;
  onClick?: () => void;
}) {
  const src = providerLogo(slug);
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex min-h-32 items-start justify-between rounded-xl border bg-white p-5 text-left transition-all duration-140',
        disabled
          ? 'cursor-not-allowed border-border-soft opacity-60'
          : 'border-border-soft hover:-translate-y-px hover:border-blue-line hover:shadow-card',
      )}
    >
      <span className="flex flex-col">
        <span className="flex items-center gap-2">
          <span className="text-[14px] font-medium text-text-primary">{name}</span>
          {comingSoon ? (
            <span className="rounded-full bg-panel-soft px-2 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.06em] text-text-faint">
              Soon
            </span>
          ) : null}
        </span>
        <span className="mt-2 block text-[12.5px] text-text-subtle">{detail}</span>
      </span>
      {src ? (
        <img
          src={src}
          alt={`${name} logo`}
          width={20}
          height={20}
          className="h-5 w-5"
          loading="lazy"
        />
      ) : (
        <span className="h-5 w-5 rounded bg-panel-soft" />
      )}
    </button>
  );
}

function ProfileList({
  profiles,
  selectedProfileId,
  loading,
  profilesForbidden,
  profilesFailed,
  deletingProfileId,
  deleteError,
  onSelect,
  onDelete,
}: {
  profiles: ConnectorAuthProfile[];
  selectedProfileId: string | null;
  loading: boolean;
  profilesForbidden: boolean;
  profilesFailed: boolean;
  deletingProfileId: string | null;
  deleteError: string | null;
  onSelect: (profileId: string) => void;
  onDelete: (profile: ConnectorAuthProfile) => void;
}) {
  if (profilesForbidden) {
    return (
      <ProfileNotice
        title="Owners and admins manage Composio profiles."
        body="You can still connect with the workspace default when it is available."
      />
    );
  }

  if (profilesFailed) {
    return (
      <ProfileNotice
        title="Couldn’t load connection profiles."
        body="Refresh the page before adding a customer-owned Composio account."
      />
    );
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-border-soft bg-white p-4">
        <div className="h-4 w-32 rounded bg-panel-soft" />
        <div className="mt-3 h-14 rounded-lg bg-panel-soft/70" />
        <div className="mt-2 h-14 rounded-lg bg-panel-soft/50" />
      </div>
    );
  }

  if (profiles.length === 0) {
    return (
      <ProfileNotice
        title="No Composio profile is ready."
        body="Add your Composio API key and Notion auth config ID, or ask your deployment admin to enable Open42 managed Composio."
      />
    );
  }

  return (
    <div className="rounded-xl border border-border-soft bg-white">
      <div className="border-b border-border-soft px-4 py-3">
        <p className="text-[13px] font-medium text-text-primary">Available profiles</p>
        <p className="mt-0.5 text-[12px] text-text-subtle">
          New live connections use the selected profile.
        </p>
      </div>
      <ul className="divide-y divide-border-soft">
        {profiles.map((profile) => {
          const configured = profileSupportsService(profile, 'notion');
          const selected = selectedProfileId === profile.id;
          return (
            <li key={profile.id}>
              <div
                className={cn(
                  'flex items-start gap-3 px-4 py-3 transition-colors duration-140',
                  selected && 'bg-blue-soft/30',
                  !configured && 'opacity-60',
                )}
              >
                <label
                  className={cn(
                    'flex min-w-0 flex-1 items-start gap-3',
                    configured ? 'cursor-pointer' : 'cursor-not-allowed',
                  )}
                >
                  <input
                    type="radio"
                    name="connector-auth-profile"
                    value={profile.id}
                    checked={selected}
                    disabled={!configured}
                    onChange={() => onSelect(profile.id)}
                    className="mt-1 h-4 w-4 accent-blue"
                  />
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-[13px] font-medium text-text-primary">
                        {profile.label}
                      </span>
                      <Tag tone={profile.mode === 'byok' ? 'neutral' : 'success'}>
                        {profileModeLabel(profile.mode)}
                      </Tag>
                    </span>
                    <span className="mt-1 flex flex-wrap gap-1.5">
                      <ServicePill ready={configured}>Notion</ServicePill>
                      <ServicePill ready={false}>Slack planned</ServicePill>
                      <ServicePill ready={false}>Google Docs planned</ServicePill>
                    </span>
                  </span>
                </label>
                {profile.mode === 'byok' ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => onDelete(profile)}
                    disabled={deletingProfileId === profile.id}
                    aria-label={`Remove ${profile.label}`}
                    className="shrink-0"
                  >
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={1.6} />
                    {deletingProfileId === profile.id ? 'Removing' : 'Remove'}
                  </Button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      {deleteError ? (
        <p
          role="alert"
          className="border-t border-border-soft px-4 py-3 text-[12px] text-destructive"
        >
          {deleteError}
        </p>
      ) : null}
    </div>
  );
}

function ByokProfileForm({
  label,
  apiKey,
  notionAuthConfigId,
  saveState,
  disabled,
  onLabelChange,
  onApiKeyChange,
  onNotionAuthConfigIdChange,
  onSubmit,
}: {
  label: string;
  apiKey: string;
  notionAuthConfigId: string;
  saveState: 'idle' | 'saving' | 'saved' | 'error';
  disabled: boolean;
  onLabelChange: (value: string) => void;
  onApiKeyChange: (value: string) => void;
  onNotionAuthConfigIdChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const canSubmit =
    !disabled &&
    saveState !== 'saving' &&
    apiKey.trim().length > 0 &&
    notionAuthConfigId.trim().length > 0;

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-xl border border-border-soft bg-white p-4"
      noValidate
    >
      <p className="text-[13px] font-medium text-text-primary">My Composio account</p>
      <p className="mt-0.5 text-[12px] text-text-subtle">
        Store a workspace-scoped API key and Notion auth config for future live
        connections.
      </p>
      <div className="mt-4 grid gap-3">
        <FieldLabel label="Profile label">
          <Input
            value={label}
            onChange={(event) => onLabelChange(event.target.value)}
            placeholder="My Composio account"
            disabled={disabled}
          />
        </FieldLabel>
        <FieldLabel label="Composio API key">
          <Input
            value={apiKey}
            onChange={(event) => onApiKeyChange(event.target.value)}
            placeholder="cmp_..."
            type="password"
            autoComplete="off"
            spellCheck={false}
            mono
            disabled={disabled}
          />
        </FieldLabel>
        <FieldLabel label="Notion auth config ID">
          <Input
            value={notionAuthConfigId}
            onChange={(event) => onNotionAuthConfigIdChange(event.target.value)}
            placeholder="ac_..."
            autoComplete="off"
            spellCheck={false}
            mono
            disabled={disabled}
          />
        </FieldLabel>
        <div className="flex items-center gap-3">
          <Button type="submit" size="sm" disabled={!canSubmit}>
            {saveState === 'saving'
              ? 'Saving'
              : saveState === 'saved'
                ? 'Saved'
                : 'Save profile'}
          </Button>
          {saveState === 'error' ? (
            <span className="text-[12px] text-destructive">Could not save.</span>
          ) : null}
        </div>
      </div>
    </form>
  );
}

function ProfileNotice({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-white p-5">
      <p className="text-[13px] font-medium text-text-primary">{title}</p>
      <p className="mt-1 text-[12.5px] leading-[1.55] text-text-subtle">{body}</p>
    </div>
  );
}

function ServicePill({
  ready,
  children,
}: {
  ready: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        'rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em]',
        ready ? 'bg-blue-soft text-blue' : 'bg-panel-soft text-text-faint',
      )}
    >
      {children}
    </span>
  );
}

function Tag({
  tone,
  children,
}: {
  tone: 'neutral' | 'success';
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        'rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em]',
        tone === 'neutral' && 'bg-panel-soft text-text-subtle',
        tone === 'success' && 'bg-blue-soft text-blue',
      )}
    >
      {children}
    </span>
  );
}

function FieldLabel({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-text-faint">
        {label}
      </span>
      <div className="mt-1.5">{children}</div>
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
        'h-10 w-full rounded-lg border border-border bg-white px-3 text-[14px] text-text-primary placeholder:text-text-faint focus:border-blue-line focus:outline-none focus:ring-[3px] focus:ring-blue-soft disabled:cursor-not-allowed disabled:bg-panel-soft disabled:text-text-faint',
        mono && 'font-mono text-[13px]',
        className,
      )}
    />
  );
}

function NotionModal({
  onClose,
  onOAuth,
  composioEnabled,
  profileLabel,
  uploadState,
  onUpload,
}: {
  onClose: () => void;
  onOAuth: () => void;
  composioEnabled: boolean;
  profileLabel: string;
  uploadState: 'idle' | 'uploading' | 'done' | 'error';
  onUpload: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-text-primary/15 px-4 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl border border-border-soft bg-white p-6 shadow-elevate"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div>
            <p className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-text-faint">
              CONNECT · NOTION
            </p>
            <h2 className="mt-1 text-[18px] font-medium text-text-primary">
              How would you like to <span className="font-serif italic">share it?</span>
            </h2>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" strokeWidth={1.6} />
          </Button>
        </div>
        <div className="mt-5 grid gap-3">
          {composioEnabled ? (
            <button
              type="button"
              className="flex items-center justify-between rounded-xl border border-border-soft p-4 text-left transition-all duration-140 hover:-translate-y-px hover:border-blue-line hover:shadow-card"
              onClick={onOAuth}
            >
              <span>
                <span className="block text-[14px] font-medium text-text-primary">
                  Connect live
                </span>
                <span className="mt-0.5 block text-[12.5px] text-text-subtle">
                  OAuth via {profileLabel} · keeps in sync
                </span>
              </span>
              <PlugZap className="h-5 w-5 text-blue" strokeWidth={1.6} />
            </button>
          ) : null}
          <label className="flex cursor-pointer items-center justify-between rounded-xl border border-border-soft p-4 text-left transition-all duration-140 hover:-translate-y-px hover:border-blue-line hover:shadow-card">
            <span>
              <span className="block text-[14px] font-medium text-text-primary">Upload zip</span>
              <span className="mt-0.5 block text-[12.5px] text-text-subtle">
                {uploadState === 'uploading'
                  ? 'Uploading…'
                  : uploadState === 'done'
                    ? 'Queued for indexing'
                    : uploadState === 'error'
                      ? 'Upload failed — try again'
                      : 'Notion export · one-time snapshot'}
              </span>
            </span>
            <FileArchive className="h-5 w-5 text-text-subtle" strokeWidth={1.6} />
            <input type="file" accept=".zip" className="sr-only" onChange={onUpload} />
          </label>
        </div>
      </div>
    </div>
  );
}
