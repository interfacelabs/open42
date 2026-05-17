import { useEffect, useMemo, useState } from 'react';
import { Share, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import Markdown from 'react-native-markdown-display';
import { ExternalLink, Link as LinkIcon } from 'lucide-react-native';
import useSWR from 'swr';

import type { ShareLinkResult, SkillDraft } from '@open42/shared-types';

import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { Sheet } from '@/components/ui/Sheet';
import { AppText } from '@/components/ui/Text';
import type { RootStackParamList } from '@/navigation/types';
import { useAuthStore } from '@/store/auth';
import { useSkillsStore } from '@/store/skills';
import { apiFetcher, apiFetch } from '@/utils/api';
import { formatRelativeDate } from '@/utils/dates';
import { apiErrorCode, humanizeError } from '@/utils/errors';
import { colors, fonts } from '@/utils/theme';

type Props = NativeStackScreenProps<RootStackParamList, 'SkillDetail'>;

const MAX_RENDERED_MARKDOWN_CHARS = 24_000;
const MAX_RENDERED_MARKDOWN_LINES = 600;

export function SkillDetailScreen({ route, navigation }: Props) {
  const workspaceId = useAuthStore((state) => state.currentWorkspaceId);
  const workspaceName = useAuthStore((state) => state.current?.workspace?.name ?? null);
  const cacheShareLink = useSkillsStore((state) => state.cacheShareLink);
  const cachedShareLink = useSkillsStore((state) => state.shareLinks[route.params.skillId] ?? null);
  const shareLinkRemainingMs = useSkillsStore((state) => state.shareLinkRemainingMs);
  const [sheet, setSheet] = useState<'actions' | 'install' | null>(null);
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const {
    data,
    error: loadError,
    mutate,
  } = useSWR<{ draft: SkillDraft }>(
    workspaceId
      ? `/workspaces/${encodeURIComponent(workspaceId)}/skills/${encodeURIComponent(route.params.skillId)}/draft`
      : null,
    apiFetcher
  );
  const draft = data?.draft;
  const markdownPreview = useMemo(() => (draft ? boundedMarkdownBody(draft.body) : null), [draft]);
  const receipt = useMemo(() => {
    if (!draft) return null;
    return `Signed by ${workspaceName ?? 'Workspace'} · ${draft.cites.length} sources · ${
      draft.staleness ? 'stale' : 'all fresh'
    } · v${draft.version}`;
  }, [draft, workspaceName]);
  const cachedRemainingMs = cachedShareLink
    ? shareLinkRemainingMs(route.params.skillId, now)
    : null;

  useEffect(() => {
    if (!cachedShareLink) return;
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [cachedShareLink]);

  async function generateShareLink() {
    if (!workspaceId || !draft || sharing) return;
    setSharing(true);
    setError(null);
    try {
      const link = await apiFetch<ShareLinkResult>(
        `/workspaces/${encodeURIComponent(workspaceId)}/skills/${encodeURIComponent(draft.id)}/share`,
        { method: 'POST' }
      );
      cacheShareLink(draft.id, link);
      await Share.share({
        title: `${draft.name} skill`,
        message: `${draft.name} skill share link (expires ${formatRelativeDate(link.expiresAt)}): ${link.url}`,
        url: link.url,
      });
      await mutate();
    } catch (err) {
      setError(apiErrorCode(err));
    } finally {
      setSharing(false);
    }
  }

  return (
    <Screen
      footer={
        draft ? (
          <Button
            icon={<LinkIcon color={colors.surface} size={16} strokeWidth={1.5} />}
            onPress={() => setSheet('actions')}>
            Share or install
          </Button>
        ) : null
      }>
      <View className="mb-5">
        <AppText variant="eyebrow" tone="faint" weight="medium">
          Skill
        </AppText>
        <AppText variant="title" style={{ marginTop: 4 }}>
          {draft?.name ?? route.params.skillName ?? 'Skill'}
        </AppText>
        {receipt ? (
          <AppText variant="caption" tone="subtle" style={{ marginTop: 8 }}>
            {receipt}
          </AppText>
        ) : (
          <AppText variant="caption" tone="faint" style={{ marginTop: 8 }}>
            Loading receipt
          </AppText>
        )}
      </View>

      {draft?.staleness ? (
        <Card style={{ marginBottom: 14 }}>
          <View className="flex-row items-start justify-between gap-3">
            <View className="flex-1">
              <StatusBadge label="stale" tone="warning" />
              <AppText variant="muted" tone="body" style={{ marginTop: 8 }}>
                {draft.staleness.changelog}
              </AppText>
            </View>
            <Button size="sm" variant="secondary" onPress={() => setSheet('actions')}>
              Re-export
            </Button>
          </View>
        </Card>
      ) : null}

      {loadError ? (
        <Card>
          <EmptyState
            title="Could not load this skill."
            body={humanizeError(apiErrorCode(loadError))}
            action={
              <Button size="sm" variant="secondary" onPress={() => void mutate()}>
                Retry
              </Button>
            }
          />
        </Card>
      ) : draft ? (
        <>
          <Card style={{ marginBottom: 14 }}>
            <AppText variant="section">Generated from</AppText>
            <View className="mt-3 gap-2">
              {draft.cites.map((cite) => (
                <AppText key={`${cite.index}-${cite.slug}`} variant="mono" tone="subtle">
                  [{cite.index}] {cite.slug}
                </AppText>
              ))}
            </View>
          </Card>
          {markdownPreview?.truncated ? (
            <Card style={{ marginBottom: 14 }}>
              <StatusBadge label="preview" tone="warning" />
              <AppText variant="muted" tone="body" style={{ marginTop: 8 }}>
                This skill body is large, so mobile is showing a bounded preview. Open the signed
                bundle to inspect the full artifact.
              </AppText>
            </Card>
          ) : null}
          <Markdown style={markdownStyles}>{markdownPreview?.body ?? ''}</Markdown>
        </>
      ) : (
        <Card>
          <AppText variant="body" tone="subtle">
            Preparing skill body and receipts.
          </AppText>
        </Card>
      )}

      <Sheet visible={sheet === 'actions'} title="Skill actions" onClose={() => setSheet(null)}>
        <View className="gap-3">
          {error ? (
            <AppText variant="caption" tone="error">
              {humanizeError(error)}
            </AppText>
          ) : null}
          <AppText variant="caption" tone="subtle">
            Share links expire after 24 hours. You can generate a fresh link any time.
          </AppText>
          {cachedShareLink ? (
            <AppText variant="caption" tone="subtle">
              Cached link: {formatRemaining(cachedRemainingMs)}. Expires{' '}
              {formatRelativeDate(cachedShareLink.expiresAt)}.
            </AppText>
          ) : null}
          <Button
            loading={sharing}
            icon={<LinkIcon color={colors.surface} size={16} strokeWidth={1.5} />}
            onPress={() => void generateShareLink()}>
            {sharing ? 'Generating' : 'Generate share link'}
          </Button>
          <Button
            variant="secondary"
            icon={<ExternalLink color={colors.textBody} size={16} strokeWidth={1.5} />}
            onPress={() => setSheet('install')}>
            Open install instructions
          </Button>
          <Button variant="ghost" onPress={() => navigation.navigate('Mcp')}>
            Connect MCP-compatible agent
          </Button>
        </View>
      </Sheet>

      <Sheet
        visible={sheet === 'install'}
        title="Install instructions"
        onClose={() => setSheet(null)}>
        {draft ? (
          <InstallInstructions
            draft={draft}
            onConnectMcp={() => {
              setSheet(null);
              navigation.navigate('Mcp');
            }}
          />
        ) : null}
      </Sheet>
    </Screen>
  );
}

function InstallInstructions({
  draft,
  onConnectMcp,
}: {
  draft: SkillDraft;
  onConnectMcp: () => void;
}) {
  const targets = [
    {
      name: 'Claude Code',
      path: `~/.claude/skills/${draft.name}`,
      steps: [
        'Open Claude Code on desktop.',
        'Paste the share link into a trusted browser.',
        'Copy the skill folder into the skills directory.',
      ],
    },
    {
      name: 'openclaw',
      path: `~/.openclaw/skills/${draft.name}`,
      steps: [
        'Open openclaw on desktop.',
        'Download the signed bundle.',
        'Place the bundle contents into the skills directory.',
      ],
    },
    {
      name: 'hermes',
      path: `~/.hermes/skills/${draft.name}`,
      steps: [
        'Open hermes on desktop.',
        'Import the signed skill bundle.',
        'Verify the receipt before enabling it.',
      ],
    },
  ];
  return (
    <View className="gap-5">
      {draft.explainer ? (
        <View>
          <AppText variant="body" weight="medium">
            Why this skill exists
          </AppText>
          <AppText variant="caption" tone="subtle" style={{ marginTop: 6 }}>
            {draft.explainer}
          </AppText>
        </View>
      ) : null}
      {targets.map((target) => (
        <View key={target.name}>
          <AppText variant="body" weight="medium">
            {target.name}
          </AppText>
          <AppText variant="mono" tone="subtle" style={{ marginTop: 4 }}>
            {target.path}
          </AppText>
          {target.steps.map((step, index) => (
            <AppText key={step} variant="caption" tone="subtle" style={{ marginTop: 4 }}>
              {index + 1}. {step}
            </AppText>
          ))}
        </View>
      ))}
      <Button variant="secondary" onPress={onConnectMcp}>
        Connect MCP-compatible agent
      </Button>
    </View>
  );
}

function boundedMarkdownBody(value: string): { body: string; truncated: boolean } {
  const cappedByChars = value.slice(0, MAX_RENDERED_MARKDOWN_CHARS);
  const lines = cappedByChars.split('\n');
  const cappedByLines = lines.slice(0, MAX_RENDERED_MARKDOWN_LINES).join('\n').trimEnd();
  const truncated =
    value.length > MAX_RENDERED_MARKDOWN_CHARS || lines.length > MAX_RENDERED_MARKDOWN_LINES;

  if (!truncated) return { body: value, truncated: false };

  return {
    body: `${cappedByLines}\n\n_Additional content hidden on mobile to keep the preview responsive._`,
    truncated: true,
  };
}

const markdownStyles = {
  body: {
    color: colors.textBody,
    fontFamily: fonts.sans,
    fontSize: 15,
    lineHeight: 24,
  },
  heading1: {
    color: colors.textPrimary,
    fontFamily: fonts.sansMedium,
    fontSize: 24,
    fontWeight: '500' as const,
    lineHeight: 30,
  },
  heading2: {
    color: colors.textPrimary,
    fontFamily: fonts.sansMedium,
    fontSize: 20,
    fontWeight: '500' as const,
    lineHeight: 26,
  },
  code_inline: {
    backgroundColor: colors.surfaceMuted,
    color: colors.textPrimary,
    fontFamily: fonts.mono,
  },
  fence: {
    backgroundColor: colors.surfaceMuted,
    color: colors.textPrimary,
    fontFamily: fonts.mono,
  },
  link: {
    color: colors.accent,
  },
};

function formatRemaining(ms: number | null): string {
  if (ms === null) return 'unknown';
  if (ms <= 0) return 'expired';
  const totalMinutes = Math.ceil(ms / 60_000);
  if (totalMinutes < 60) return `${totalMinutes}m remaining`;
  const totalHours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (totalHours < 24) {
    return minutes > 0 ? `${totalHours}h ${minutes}m remaining` : `${totalHours}h remaining`;
  }
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return hours > 0 ? `${days}d ${hours}h remaining` : `${days}d remaining`;
}
