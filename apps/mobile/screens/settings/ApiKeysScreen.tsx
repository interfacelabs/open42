import { useMemo, useState } from 'react';
import { RefreshControl, View } from 'react-native';
import useSWR from 'swr';

import type {
  LlmProvider,
  LlmScope,
  WorkspaceCredentialEntry,
  WorkspaceCredentialsPayload,
} from '@open42/shared-types';

import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { ListRow } from '@/components/ListRow';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { AppText } from '@/components/ui/Text';
import { TextField } from '@/components/ui/TextField';
import { useAuthStore } from '@/store/auth';
import { apiFetcher, apiFetch } from '@/utils/api';
import { formatRelativeDate } from '@/utils/dates';
import { apiErrorCode, humanizeError } from '@/utils/errors';

const PROVIDER_LABEL: Record<LlmProvider, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
};

const SCOPE_LABEL: Record<LlmScope, string> = {
  chat: 'Chat',
  embed: 'Embed',
};

export function ApiKeysScreen() {
  const workspaceId = useAuthStore((state) => state.currentWorkspaceId);
  const [provider, setProvider] = useState<LlmProvider>('openai');
  const [scope, setScope] = useState<LlmScope>('chat');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const {
    data,
    error: loadError,
    isValidating,
    mutate,
  } = useSWR<WorkspaceCredentialsPayload>(
    workspaceId ? `/workspaces/${encodeURIComponent(workspaceId)}/credentials` : null,
    apiFetcher
  );
  const credentials = useMemo(() => data?.credentials ?? [], [data?.credentials]);
  const unsupported = provider === 'anthropic' && scope === 'embed';
  const canSave = !!workspaceId && !saving && !unsupported && apiKey.trim().length > 0;
  const loadErrorCode = apiErrorCode(loadError);
  const ownerOnly = loadErrorCode === 'forbidden' || loadErrorCode === 'forbidden_owner_only';
  const sortedCredentials = useMemo(
    () =>
      [...credentials].sort((a, b) =>
        `${a.provider}:${a.scope}`.localeCompare(`${b.provider}:${b.scope}`)
      ),
    [credentials]
  );

  async function saveKey() {
    if (!workspaceId || !canSave) return;
    setSaving(true);
    setError(null);
    const entry: WorkspaceCredentialEntry = {
      provider,
      scope,
      model: model.trim() || null,
      createdAt: new Date().toISOString(),
    };
    await mutate(
      {
        credentials: [
          entry,
          ...credentials.filter((item) => item.provider !== provider || item.scope !== scope),
        ],
      },
      false
    );
    try {
      await apiFetch(`/workspaces/${encodeURIComponent(workspaceId)}/credentials`, {
        method: 'POST',
        body: {
          provider,
          scope,
          apiKey: apiKey.trim(),
          ...(model.trim() ? { model: model.trim() } : {}),
        },
      });
      setApiKey('');
      setModel('');
      await mutate();
    } catch (err) {
      setError(apiErrorCode(err));
      await mutate();
    } finally {
      setSaving(false);
    }
  }

  async function removeKey(credential: WorkspaceCredentialEntry) {
    if (!workspaceId) return;
    setError(null);
    await mutate(
      {
        credentials: credentials.filter(
          (item) => item.provider !== credential.provider || item.scope !== credential.scope
        ),
      },
      false
    );
    try {
      await apiFetch(`/workspaces/${encodeURIComponent(workspaceId)}/credentials`, {
        method: 'DELETE',
        body: { provider: credential.provider, scope: credential.scope },
      });
      await mutate();
    } catch (err) {
      setError(apiErrorCode(err));
      await mutate();
    }
  }

  return (
    <Screen
      refreshControl={<RefreshControl refreshing={isValidating} onRefresh={() => void mutate()} />}>
      <AppText variant="eyebrow" tone="faint" weight="medium">
        API keys
      </AppText>
      <AppText variant="title" style={{ marginTop: 4 }}>
        Provider keys
      </AppText>
      <AppText variant="muted" tone="subtle" style={{ marginTop: 8 }}>
        Bring your own LLM and embedding keys for this workspace.
      </AppText>

      {loadError ? (
        <Card style={{ marginTop: 18 }}>
          <EmptyState
            title={ownerOnly ? 'Owner access required.' : 'Could not load API keys.'}
            body={
              ownerOnly
                ? 'Only workspace owners can manage provider keys.'
                : humanizeError(loadErrorCode)
            }
            action={
              <Button size="sm" variant="secondary" onPress={() => void mutate()}>
                Retry
              </Button>
            }
          />
        </Card>
      ) : null}

      {!ownerOnly ? (
        <Card style={{ marginTop: 18 }}>
          <AppText variant="section">Add a key</AppText>
          <View className="mt-3 gap-3">
            <Segmented
              label="Provider"
              value={provider}
              options={[
                ['openai', 'OpenAI'],
                ['anthropic', 'Anthropic'],
              ]}
              onChange={(value) => {
                setProvider(value as LlmProvider);
                setError(null);
              }}
            />
            <Segmented
              label="Scope"
              value={scope}
              options={[
                ['chat', 'Chat'],
                ['embed', 'Embed'],
              ]}
              onChange={(value) => {
                setScope(value as LlmScope);
                setError(null);
              }}
            />
            {unsupported ? (
              <AppText variant="caption" tone="warning">
                Anthropic does not expose an embeddings API. Use OpenAI for embed.
              </AppText>
            ) : null}
            <TextField
              value={apiKey}
              placeholder={provider === 'openai' ? 'sk-...' : 'sk-ant-...'}
              secureTextEntry
              onChangeText={setApiKey}
            />
            <TextField
              value={model}
              placeholder={scope === 'embed' ? 'text-embedding-3-large' : 'model override'}
              onChangeText={setModel}
            />
            {error ? (
              <AppText variant="caption" tone="error">
                {humanizeError(error)}
              </AppText>
            ) : null}
            <Button loading={saving} disabled={!canSave} onPress={() => void saveKey()}>
              {saving ? 'Saving' : 'Save key'}
            </Button>
          </View>
        </Card>
      ) : null}

      <View className="mt-6">
        <AppText variant="section">Configured keys</AppText>
        {sortedCredentials.length === 0 ? (
          <EmptyState title="No keys yet." body="Configured provider keys appear here." />
        ) : (
          sortedCredentials.map((credential) => (
            <ListRow
              key={`${credential.provider}:${credential.scope}`}
              title={PROVIDER_LABEL[credential.provider]}
              subtitle={`${SCOPE_LABEL[credential.scope]}${
                credential.model ? ` · ${credential.model}` : ''
              } · added ${formatRelativeDate(credential.createdAt)}`}
              right={
                <View className="items-end gap-2">
                  <StatusBadge label="configured" tone="success" />
                  <Button size="sm" variant="ghost" onPress={() => void removeKey(credential)}>
                    Remove
                  </Button>
                </View>
              }
            />
          ))
        )}
      </View>
    </Screen>
  );
}

function Segmented({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: [string, string][];
  onChange: (value: string) => void;
}) {
  return (
    <View>
      <AppText variant="caption" tone="faint" weight="medium">
        {label}
      </AppText>
      <View className="mt-2 flex-row gap-2">
        {options.map(([optionValue, optionLabel]) => (
          <Button
            key={optionValue}
            size="sm"
            variant={value === optionValue ? 'secondary' : 'ghost'}
            onPress={() => onChange(optionValue)}>
            {optionLabel}
          </Button>
        ))}
      </View>
    </View>
  );
}
