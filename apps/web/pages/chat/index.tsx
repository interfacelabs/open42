import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from 'react';
import { ArrowUp, Sparkles } from 'lucide-react';
import useSWR from 'swr';

import { cn } from '@/lib/utils';

import type { ChatMessage } from '@/components/chat-types';
import { HorizonGlyph } from '@/components/HorizonGlyph';
import { MobileNavTrigger } from '@/components/MobileNavTrigger';
import { QuickSwitcher } from '@/components/QuickSwitcher';
import { ReceiptsRail } from '@/components/ReceiptsRail';
import { Sidebar } from '@/components/Sidebar';
import { SkillPanel } from '@/components/SkillPanel';
import { SlashMenu } from '@/components/SlashMenu';
import { Transcript } from '@/components/Transcript';
import { fetcher } from '@/lib/api';
import { csrfHeaders } from '@/lib/csrf';
import type { SkillDraft } from '@/lib/skill-types';
import { useWorkspaceStore } from '@/lib/workspaces/store';
import { recoverFromTenant403 } from '@/lib/workspaces/with-recovery';

interface ChatWorkspaceConnection {
  id: string;
  kind: string;
  status: string;
}

interface ChatWorkspacePayload {
  workspace: { id: string; name: string } | null;
  connections?: ChatWorkspaceConnection[];
}

export default function ChatPage() {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const [activeCitationIndex, setActiveCitationIndex] = useState<number | null>(null);
  const [skillDraftId, setSkillDraftId] = useState<string | null>(null);
  const [skillError, setSkillError] = useState<string | null>(null);
  const [skillifying, setSkillifying] = useState(false);
  const [recoveryToast, setRecoveryToast] = useState<string | null>(null);
  const currentAssistantId = useRef<string | null>(null);
  const hydratedRef = useRef(false);

  // Resolve the caller's workspace so chat can send `workspace_id` in the
  // body. We read directly from the Zustand workspace store: switchTo()
  // updates the store synchronously, while /api/workspaces/current resolves
  // via currentWorkspaceForUser and may lag behind a recent switch (the
  // dashboard polls every few seconds). Sourcing from the store removes
  // that race so post-switch chat sends carry the right workspace_id.
  // The API still enforces membership via requireMembership — a stale id
  // here returns 403, which the recovery path below handles.
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);

  // Active skill mode — if `?skill=<id>` is in the URL, every question in
  // this thread runs against that skill's body as a binding policy. Loaded
  // via SWR so the badge can show name + version without a route change.
  const activeSkillId = firstQueryParam(router.query.skill);
  const { data: activeSkillData } = useSWR<{ draft: SkillDraft }>(
    activeSkillId && workspaceId
      ? `/api/workspaces/${encodeURIComponent(workspaceId)}/skills/${encodeURIComponent(activeSkillId)}/draft`
      : null,
    fetcher,
  );
  const activeSkill = activeSkillData?.draft ?? null;

  // Connections — the chat surface is useless without at least one source.
  // If the workspace has none, we replace the transcript with a calm CTA
  // that pushes the user toward /settings/connections/add.
  const { data: workspaceData } = useSWR<ChatWorkspacePayload>(
    '/api/workspaces/current',
    fetcher,
  );
  const hasNoSources =
    workspaceData !== undefined &&
    (workspaceData.connections ?? []).length === 0;

  // Hydrate input from ?q= when the user lands here from the home ask-first
  // prompt. Strip the query param so a refresh doesn't re-prefill.
  useEffect(() => {
    if (!router.isReady || hydratedRef.current) return;
    const raw = router.query.q;
    const q = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw[0] : '';
    if (q && q.trim()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setInput(q);
      void router.replace('/chat', undefined, { shallow: true });
    }
    hydratedRef.current = true;
  }, [router]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = input.trim();
    if (!query) return;
    if (query.startsWith('/sources')) {
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: 'system',
          text: 'Use the citation chips on the last answer to inspect sources.',
        },
      ]);
      setInput('');
      return;
    }

    const userMessage: ChatMessage = { id: crypto.randomUUID(), role: 'user', text: query };
    const assistantId = crypto.randomUUID();
    currentAssistantId.current = assistantId;
    setMessages((current) => [
      ...current,
      userMessage,
      { id: assistantId, role: 'assistant', text: '', citations: [] },
    ]);
    setInput('');
    setThinking(true);

    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
      body: JSON.stringify({
        query,
        workspace_id: workspaceId,
        ...(activeSkillId ? { skillId: activeSkillId } : {}),
      }),
    });

    // Tenant-scoped recovery: the cookie's current workspace no longer matches
    // anything the user is a member of. The shared helper refreshes the
    // membership list, switches workspaces (or bounces to onboard), and routes
    // — we layer the chat-specific toast on top.
    if (response.status === 403) {
      setThinking(false);
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantId
            ? { ...message, text: 'Recovering workspace…' }
            : message,
        ),
      );
      const outcome = await recoverFromTenant403();
      if (outcome.kind === 'no_workspaces') {
        setRecoveryToast("You're not in any workspace — please create one.");
      } else {
        setRecoveryToast('You were removed from this workspace — switched to another.');
      }
      return;
    }

    if (!response.ok || !response.body) {
      setThinking(false);
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantId
            ? { ...message, text: 'The brain is not ready to answer yet.' }
            : message,
        ),
      );
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        applyStreamEvent(assistantId, JSON.parse(line));
      }
    }
    setThinking(false);
  }

  function applyStreamEvent(assistantId: string, event: any) {
    if (event.type === 'citations') {
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantId ? { ...message, citations: event.citations } : message,
        ),
      );
    }
    if (event.type === 'token') {
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantId ? { ...message, text: message.text + event.text } : message,
        ),
      );
      setThinking(false);
    }
  }

  async function downloadSkill(draft: SkillDraft) {
    setSkillError(null);
    if (!workspaceId) {
      setSkillError('no_active_workspace');
      return;
    }
    const response = await fetch(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/skills/${encodeURIComponent(draft.id)}`,
      {
        method: 'POST',
        headers: csrfHeaders(),
      },
    );
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      setSkillError(payload.error ?? 'skill_export_failed');
      return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${draft.name}-skill.zip`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function skillifyThread() {
    if (skillifying) return;
    const intent = lastUserQuestion(messages);
    if (!intent) {
      setSkillError('skillify_no_intent');
      return;
    }
    const threadCitations = latestCitations.map((c) => ({
      slug: c.slug,
      lastUpdated: c.last_updated ?? undefined,
    }));

    setSkillError(null);
    setSkillifying(true);
    if (!workspaceId) {
      setSkillError('no_active_workspace');
      setSkillifying(false);
      return;
    }
    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceId)}/skills`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
          body: JSON.stringify({ intent, threadCitations }),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        draft?: SkillDraft;
        error?: string;
      };
      if (!response.ok || !payload.draft) {
        setSkillError(payload.error ?? 'skillify_failed');
        return;
      }
      // Open the panel against the freshly minted skill. SkillPanel re-fetches
      // /api/skills/:id/draft via SWR so the panel state mirrors the server.
      setSkillDraftId(payload.draft.id);
    } catch {
      setSkillError('network_error');
    } finally {
      setSkillifying(false);
    }
  }

  // The rail shows receipts from the most recent assistant turn — that's the
  // turn the user is currently reading. Earlier turns keep their inline chips
  // but don't compete for the rail. React Compiler memoizes this without the
  // explicit useMemo.
  const latestCitations = pickLatestCitations(messages);

  const isEmpty = messages.length === 0;
  const showNoSourcesEmpty = hasNoSources && isEmpty;

  return (
    <>
      <Head>
        <title>Chat — Open42</title>
      </Head>
      <div className="flex h-screen overflow-hidden bg-background">
        <Sidebar />
        <main className="flex h-screen min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center gap-3 border-b border-border-soft px-5 py-3 md:hidden">
            <MobileNavTrigger />
            <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-faint">
              Chat
            </span>
          </div>
          {activeSkill ? (
            <div className="flex shrink-0 justify-center border-b border-border-soft px-5 pb-3 pt-4 md:px-6 md:pt-5">
              <SkillModeBadge
                skill={activeSkill}
                onClear={() => router.push('/chat', undefined, { shallow: true })}
              />
            </div>
          ) : null}

          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-chat px-6 pb-6 pt-12">
              {showNoSourcesEmpty ? (
                <NoSourcesEmpty />
              ) : isEmpty ? (
                <EmptyPrompt />
              ) : (
                <>
                  <Transcript
                    messages={messages}
                    thinking={thinking}
                    activeCitationIndex={activeCitationIndex}
                    onActivateCitation={setActiveCitationIndex}
                  />
                  {!thinking && latestCitations.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => void skillifyThread()}
                      disabled={skillifying}
                      className="mt-8 inline-flex items-center gap-1.5 rounded-full border border-dashed border-blue-line px-3 py-1 text-[11.5px] text-blue transition-colors duration-140 hover:bg-blue-soft disabled:cursor-progress disabled:opacity-60"
                    >
                      <Sparkles size={11} strokeWidth={1.6} />
                      {skillifying ? 'Skillifying…' : 'Skillify this thread'}
                    </button>
                  ) : null}
                  {skillError ? (
                    <p role="alert" className="mt-3 text-[12px] font-medium text-destructive">
                      {humanizeSkillError(skillError)}
                    </p>
                  ) : null}
                </>
              )}
            </div>
          </div>

          {showNoSourcesEmpty ? null : (
            <div className="shrink-0">
              <Composer
                input={input}
                onChange={setInput}
                onSubmit={submit}
                disabled={thinking}
              />
            </div>
          )}
        </main>
        <ReceiptsRail
          citations={latestCitations}
          activeIndex={activeCitationIndex}
          onActivate={setActiveCitationIndex}
        />
        <SkillPanel
          draftId={skillDraftId}
          onClose={() => setSkillDraftId(null)}
          onDownload={(draft) => void downloadSkill(draft)}
        />
        <QuickSwitcher />
      </div>
    </>
  );
}

function firstQueryParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return typeof value === 'string' ? value : null;
}

function Composer({
  input,
  onChange,
  onSubmit,
  disabled,
}: {
  input: string;
  onChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  disabled?: boolean;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const canSubmit = input.trim().length > 0 && !disabled;

  // Auto-grow up to ~6 rows. Resets each render so deletes shrink the field.
  useEffect(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = 'auto';
    node.style.height = `${Math.min(node.scrollHeight, 168)}px`;
  }, [input]);

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      const form = event.currentTarget.form;
      if (form && canSubmit) form.requestSubmit();
    }
  }

  return (
    <form onSubmit={onSubmit} className="relative">
      <SlashMenu value={input} />
      <div className="mx-auto w-full max-w-chat px-6 pb-8 pt-3">
        <div className="flex items-end gap-2 rounded-3xl border border-border bg-white py-2 pl-5 pr-2 shadow-card transition-[border-color,box-shadow] duration-140 focus-within:border-blue-line focus-within:shadow-[0_0_0_3px_rgba(37,87,255,0.10)]">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder="Ask the brain…"
            className="max-h-[168px] min-h-[28px] flex-1 resize-none border-0 bg-transparent py-1.5 text-[15px] leading-[1.55] text-text-primary outline-none placeholder:text-text-faint"
          />
          <button
            type="submit"
            disabled={!canSubmit}
            aria-label="Send"
            className={cn(
              'shrink-0 flex h-9 w-9 items-center justify-center rounded-full transition-all duration-140 active:scale-[0.96]',
              canSubmit
                ? 'bg-text-primary text-white hover:brightness-110'
                : 'bg-panel-soft text-text-faint',
            )}
          >
            <ArrowUp size={16} strokeWidth={2.25} />
          </button>
        </div>
        <p className="mt-2 text-center font-mono text-[10px] text-text-faint">
          Every answer cites its source. ⏎ to send · ⇧⏎ for newline
        </p>
      </div>
    </form>
  );
}

function EmptyPrompt() {
  return (
    <div className="flex flex-col items-center pt-8 text-center">
      <p className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-text-faint">
        ASK
      </p>
      <h1 className="mt-3 text-[36px] font-medium leading-[1.05] tracking-[-0.025em] text-text-primary md:text-[42px]">
        Ask the <span className="font-serif font-normal italic">brain.</span>
      </h1>
      <p className="mt-3 max-w-[42ch] text-[13.5px] leading-relaxed text-text-subtle">
        Type below. Every answer comes with citations from your sources.
      </p>
    </div>
  );
}

function NoSourcesEmpty() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-[640px] flex-col items-center justify-center px-6 py-8 text-center">
      <HorizonGlyph size={180} />
      <h2 className="mt-2 text-[18px] font-medium leading-tight tracking-tight text-text-primary">
        The brain needs something to read.
      </h2>
      <p className="mt-2 max-w-[44ch] text-[13.5px] leading-relaxed text-text-subtle">
        Connect Notion, Drive, or upload a zip first — then come back and the
        brain can answer with <span className="font-serif italic">citations.</span>
      </p>
      <Link href="/settings/connections/add" className="btn-primary mt-6">
        Connect a source
      </Link>
    </div>
  );
}

function SkillModeBadge({ skill, onClear }: { skill: SkillDraft; onClear: () => void }) {
  return (
    <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-accent/40 bg-accent-soft px-3 py-1 text-[11px]">
      <Sparkles size={11} strokeWidth={1.5} className="text-accent" />
      <span className="font-medium text-accent">
        Skill mode · {skill.name} v{skill.version}
      </span>
      <button
        type="button"
        onClick={onClear}
        className="font-mono text-[10px] text-text-faint hover:text-text-primary"
        aria-label="Exit skill mode"
      >
        ×
      </button>
    </div>
  );
}

function pickLatestCitations(messages: ChatMessage[]) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (
      message &&
      message.role === 'assistant' &&
      message.citations &&
      message.citations.length > 0
    ) {
      return message.citations;
    }
  }
  return [];
}

function lastUserQuestion(messages: ChatMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role === 'user' && message.text.trim()) {
      return message.text.trim();
    }
  }
  return null;
}

function humanizeSkillError(code: string): string {
  switch (code) {
    case 'skillify_no_intent':
      return 'Ask the brain a question first — Skillify uses your last question as the skill\u2019s purpose.';
    case 'skill_name_already_exists':
      return 'A skill with that name already exists in this workspace. Rephrase your question to mint a different one.';
    case 'skill_generation_failed':
      return 'The brain couldn\u2019t draft a skill from this thread. Try again with a clearer question.';
    case 'skill_generation_timeout':
      return 'The brain took too long to draft. Try a simpler intent or try again in a moment.';
    case 'upstream_key_unconfigured':
      return 'No Anthropic key is configured. Add one under Settings \u2192 API Keys.';
    case 'chat_rate_limited':
    case 'chat_budget_exceeded':
      return 'You\u2019ve hit the daily chat budget. Try again later or raise the cap in settings.';
    case 'network_error':
      return 'Couldn\u2019t reach the brain. Check your connection and try again.';
    case 'skill_export_failed':
      return 'The export couldn\u2019t generate. Try again in a moment.';
    default:
      return 'Something went wrong. Try again.';
  }
}
