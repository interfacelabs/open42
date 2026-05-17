import { useMemo, useState } from 'react';
import { RefreshControl, View } from 'react-native';
import useSWR from 'swr';

import type { Invite, Member } from '@open42/shared-types';

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

export function MembersScreen() {
  const workspaceId = useAuthStore((state) => state.currentWorkspaceId);
  const [inviteText, setInviteText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const members = useSWR<{ members: Member[] }>(
    workspaceId ? `/workspaces/${encodeURIComponent(workspaceId)}/members` : null,
    apiFetcher
  );
  const invites = useSWR<{ invites: Invite[] }>(
    workspaceId ? `/workspaces/${encodeURIComponent(workspaceId)}/invites` : null,
    apiFetcher
  );
  const emails = useMemo(
    () =>
      Array.from(
        new Set(
          inviteText
            .split(/[\s,;]+/)
            .map((item) => item.trim().toLowerCase())
            .filter(Boolean)
        )
      ),
    [inviteText]
  );

  async function sendInvite() {
    if (!workspaceId || emails.length === 0 || sending) return;
    setSending(true);
    setError(null);
    const optimistic = emails.map((email) => ({
      id: `pending-${email}`,
      email,
      role: 'member' as const,
      status: 'pending' as const,
      createdAt: new Date().toISOString(),
    }));
    void invites.mutate({ invites: [...optimistic, ...(invites.data?.invites ?? [])] }, false);
    try {
      await apiFetch(`/workspaces/${encodeURIComponent(workspaceId)}/invites`, {
        method: 'POST',
        body: { emails },
      });
      setInviteText('');
      await invites.mutate();
    } catch (err) {
      setError(apiErrorCode(err));
      await invites.mutate();
    } finally {
      setSending(false);
    }
  }

  async function revoke(inviteId: string) {
    if (!workspaceId) return;
    setError(null);
    const previous = invites.data;
    await invites.mutate(
      { invites: (previous?.invites ?? []).filter((invite) => invite.id !== inviteId) },
      false
    );
    try {
      await apiFetch(
        `/workspaces/${encodeURIComponent(workspaceId)}/invites/${encodeURIComponent(inviteId)}`,
        { method: 'DELETE' }
      );
      await invites.mutate();
    } catch (err) {
      setError(apiErrorCode(err));
      await invites.mutate(previous, false);
    }
  }

  async function refresh() {
    await Promise.all([members.mutate(), invites.mutate()]);
  }

  return (
    <Screen
      refreshControl={
        <RefreshControl
          refreshing={members.isValidating || invites.isValidating}
          onRefresh={() => void refresh()}
        />
      }>
      <AppText variant="eyebrow" tone="faint" weight="medium">
        Members
      </AppText>
      <AppText variant="title" style={{ marginTop: 4 }}>
        People with access
      </AppText>

      <Card style={{ marginTop: 18 }}>
        <AppText variant="section">Invite by email</AppText>
        <View className="mt-3 gap-3">
          <TextField
            value={inviteText}
            placeholder="teammate@company.com"
            onChangeText={setInviteText}
          />
          <Button loading={sending} onPress={() => void sendInvite()}>
            {sending ? 'Sending' : 'Send invite'}
          </Button>
          {error ? (
            <AppText variant="caption" tone="error">
              {humanizeError(error)}
            </AppText>
          ) : null}
        </View>
      </Card>

      <View className="mt-6">
        <AppText variant="section">Members</AppText>
        {members.error ? (
          <EmptyState
            title="Could not load members."
            body={humanizeError(apiErrorCode(members.error))}
            action={
              <Button size="sm" variant="secondary" onPress={() => void members.mutate()}>
                Retry
              </Button>
            }
          />
        ) : (members.data?.members ?? []).length === 0 ? (
          <EmptyState title="No members loaded." body="Pull to refresh or invite a teammate." />
        ) : (
          members.data!.members.map((member) => (
            <ListRow
              key={member.userId}
              title={member.email}
              subtitle={`Joined ${formatRelativeDate(member.joinedAt)}`}
              right={<StatusBadge label={member.role} />}
            />
          ))
        )}
      </View>

      <View className="mt-6">
        <AppText variant="section">Pending invites</AppText>
        {invites.error ? (
          <EmptyState
            title="Could not load invites."
            body={humanizeError(apiErrorCode(invites.error))}
            action={
              <Button size="sm" variant="secondary" onPress={() => void invites.mutate()}>
                Retry
              </Button>
            }
          />
        ) : (invites.data?.invites ?? []).length === 0 ? (
          <EmptyState title="No pending invites." body="Sent invites appear here until accepted." />
        ) : (
          invites.data!.invites.map((invite) => (
            <ListRow
              key={invite.id}
              title={invite.email}
              subtitle={`Sent ${formatRelativeDate(invite.createdAt)}`}
              right={
                invite.id.startsWith('pending-') ? (
                  <StatusBadge label="sending" />
                ) : (
                  <Button size="sm" variant="ghost" onPress={() => void revoke(invite.id)}>
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
