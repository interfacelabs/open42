import { useState } from 'react';
import { RefreshControl, Share, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Copy } from 'lucide-react-native';

import type { McpCreatedClient } from '@open42/shared-types';

import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { ListRow } from '@/components/ListRow';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { AppText } from '@/components/ui/Text';
import { TextField } from '@/components/ui/TextField';
import { useMcpProxy } from '@/hooks/useWorkspaceData';
import { useAuthStore } from '@/store/auth';
import { apiFetch } from '@/utils/api';
import { formatRelativeDate } from '@/utils/dates';
import { apiErrorCode, humanizeError } from '@/utils/errors';
import { colors } from '@/utils/theme';

export function McpScreen() {
  const workspaceId = useAuthStore((state) => state.currentWorkspaceId);
  const { data, error: loadError, mutate, isValidating } = useMcpProxy(workspaceId);
  const [name, setName] = useState('Mobile agent');
  const [created, setCreated] = useState<McpCreatedClient | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const admin = data?.role === 'owner' || data?.role === 'admin';

  async function setEnabled(enabled: boolean) {
    if (!workspaceId) return;
    setBusy(true);
    setError(null);
    const previous = data;
    if (data) await mutate({ ...data, enabled }, false);
    try {
      await apiFetch(`/workspaces/${encodeURIComponent(workspaceId)}/mcp-proxy`, {
        method: 'POST',
        body: { enabled },
      });
      await mutate();
    } catch (err) {
      setError(apiErrorCode(err));
      await mutate(previous, false);
    } finally {
      setBusy(false);
    }
  }

  async function createClient(self = false) {
    if (!workspaceId) return;
    setBusy(true);
    setError(null);
    try {
      const payload = await apiFetch<McpCreatedClient>(
        `/workspaces/${encodeURIComponent(workspaceId)}/mcp-proxy/clients${self ? '/self' : ''}`,
        {
          method: 'POST',
          body: self ? undefined : { name, scope: 'read write' },
        }
      );
      setCreated(payload);
      await mutate();
    } catch (err) {
      setError(apiErrorCode(err));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(clientId: string) {
    if (!workspaceId) return;
    setError(null);
    const previous = data;
    if (data) {
      await mutate(
        {
          ...data,
          clients: data.clients.map((client) =>
            client.id === clientId ? { ...client, revokedAt: new Date().toISOString() } : client
          ),
        },
        false
      );
    }
    try {
      await apiFetch(
        `/workspaces/${encodeURIComponent(workspaceId)}/mcp-proxy/clients/${encodeURIComponent(clientId)}`,
        { method: 'DELETE' }
      );
      await mutate();
    } catch (err) {
      setError(apiErrorCode(err));
      await mutate(previous, false);
    }
  }

  async function copyConfig() {
    if (!created) return;
    const text = mcpConfig(created);
    await Clipboard.setStringAsync(text);
    await Share.share({ title: 'Open42 MCP config', message: text });
  }

  return (
    <Screen
      refreshControl={<RefreshControl refreshing={isValidating} onRefresh={() => void mutate()} />}>
      <AppText variant="eyebrow" tone="faint" weight="medium">
        MCP
      </AppText>
      <AppText variant="title" style={{ marginTop: 4 }}>
        Connect an agent
      </AppText>
      <AppText variant="muted" tone="subtle" style={{ marginTop: 8 }}>
        Issue credentials for MCP-compatible tools that need access to this workspace brain.
      </AppText>

      <Card style={{ marginTop: 18 }}>
        <View className="flex-row items-start justify-between gap-3">
          <View className="flex-1">
            <AppText variant="section">Proxy</AppText>
            <AppText variant="caption" tone="subtle" style={{ marginTop: 6 }}>
              {data?.mcpUrl ?? 'Proxy URL will appear when enabled and available.'}
            </AppText>
          </View>
          <StatusBadge
            label={data?.enabled ? 'enabled' : isValidating ? 'checking' : 'disabled'}
            tone={data?.enabled ? 'success' : 'neutral'}
          />
        </View>
        {admin ? (
          <View className="mt-4 flex-row gap-3">
            <Button
              size="sm"
              variant="secondary"
              loading={busy}
              onPress={() => void setEnabled(!data?.enabled)}>
              {data?.enabled ? 'Disable' : 'Enable'}
            </Button>
          </View>
        ) : null}
      </Card>

      {loadError ? (
        <Card style={{ marginTop: 14 }}>
          <EmptyState
            title="Could not load MCP status."
            body={humanizeError(apiErrorCode(loadError))}
            action={
              <Button size="sm" variant="secondary" onPress={() => void mutate()}>
                Retry
              </Button>
            }
          />
        </Card>
      ) : null}

      {data?.enabled ? (
        <Card style={{ marginTop: 14 }}>
          <AppText variant="section">{admin ? 'Create client' : 'Your client'}</AppText>
          {admin ? (
            <View className="mt-3 gap-3">
              <TextField value={name} placeholder="Client name" onChangeText={setName} />
              <Button loading={busy} onPress={() => void createClient(false)}>
                Create credentials
              </Button>
            </View>
          ) : (
            <View className="mt-3">
              <Button loading={busy} onPress={() => void createClient(true)}>
                Claim personal credentials
              </Button>
            </View>
          )}
          {error ? (
            <AppText variant="caption" tone="error" style={{ marginTop: 10 }}>
              {humanizeError(error)}
            </AppText>
          ) : null}
        </Card>
      ) : null}

      {created ? (
        <Card style={{ marginTop: 14 }}>
          <AppText variant="section">Credentials issued</AppText>
          <AppText variant="mono" tone="subtle" style={{ marginTop: 10 }}>
            {created.clientId}
          </AppText>
          <AppText variant="caption" tone="faint" style={{ marginTop: 4 }}>
            secret shown once
          </AppText>
          <View className="mt-3">
            <Button
              variant="secondary"
              icon={<Copy color={colors.textBody} size={15} strokeWidth={1.5} />}
              onPress={() => void copyConfig()}>
              Copy MCP config
            </Button>
          </View>
        </Card>
      ) : null}

      <View className="mt-6">
        <AppText variant="section">Clients</AppText>
        {(data?.clients ?? []).length === 0 ? (
          <EmptyState title="No clients yet." body="Create credentials after enabling the proxy." />
        ) : (
          data!.clients.map((client) => (
            <ListRow
              key={client.id}
              title={client.label}
              subtitle={`${client.scopes} · created ${formatRelativeDate(client.createdAt)}`}
              meta={client.revokedAt ? 'revoked' : undefined}
              right={
                client.revokedAt ? (
                  <StatusBadge label="revoked" />
                ) : (
                  <Button size="sm" variant="ghost" onPress={() => void revoke(client.id)}>
                    Revoke
                  </Button>
                )
              }
            />
          ))
        )}
      </View>
    </Screen>
  );
}

function mcpConfig(client: McpCreatedClient): string {
  return JSON.stringify(
    {
      issuerUrl: client.issuerUrl,
      tokenUrl: client.tokenUrl,
      mcpUrl: client.mcpUrl,
      clientId: client.clientId,
      clientSecret: client.clientSecret,
      grantType: client.grantType,
      scope: client.scope,
    },
    null,
    2
  );
}
