import Head from 'next/head';
import { useRouter } from 'next/router';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import useSWR from 'swr';

import type { ChatMessage } from '@/components/chat-types';
import { QuickSwitcher } from '@/components/QuickSwitcher';
import { ReceiptsRail } from '@/components/ReceiptsRail';
import { Sidebar } from '@/components/Sidebar';
import { SkillPanel } from '@/components/SkillPanel';
import { SlashMenu } from '@/components/SlashMenu';
import { Transcript } from '@/components/Transcript';
import { Button } from '@/components/ui/button';
import { fetcher } from '@/lib/api';
import type { SkillDraft } from '@/lib/skill-types';

export default function ChatPage() {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const [activeCitationIndex, setActiveCitationIndex] = useState<number | null>(null);
  const [skillDraftId, setSkillDraftId] = useState<string | null>(null);
  const [skillError, setSkillError] = useState<string | null>(null);
  const [skillifying, setSkillifying] = useState(false);
  const currentAssistantId = useRef<string | null>(null);
  const hydratedRef = useRef(false);

  // Active skill mode — if `?skill=<id>` is in the URL, every question in
  // this thread runs against that skill's body as a binding policy. Loaded
  // via SWR so the badge can show name + version without a route change.
  const activeSkillId = firstQueryParam(router.query.skill);
  const { data: activeSkillData } = useSWR<{ draft: SkillDraft }>(
    activeSkillId ? `/api/skills/${encodeURIComponent(activeSkillId)}/draft` : null,
    fetcher,
  );
  const activeSkill = activeSkillData?.draft ?? null;

  // Hydrate input from ?q= when the user lands here from the home ask-first
  // prompt. Strip the query param so a refresh doesn't re-prefill.
  useEffect(() => {
    if (!router.isReady || hydratedRef.current) return;
    const raw = router.query.q;
    const q = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw[0] : '';
    if (q && q.trim()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setInput(q);
      void router.replace('/auth/chat', undefined, { shallow: true });
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
      body: JSON.stringify(activeSkillId ? { query, skillId: activeSkillId } : { query }),
    });

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
    const response = await fetch(`/api/skills/${draft.id}`, {
      method: 'POST',
      headers: csrfHeaders(),
    });
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
    try {
      const response = await fetch('/api/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
        body: JSON.stringify({ intent, threadCitations }),
      });
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

  return (
    <>
      <Head>
        <title>Chat - Open42</title>
      </Head>
      <div className="flex min-h-screen overflow-hidden bg-background">
        <Sidebar />
        <main className="flex min-w-0 flex-1 flex-col px-10 py-8">
          <div className="flex w-full max-w-chat flex-1 flex-col">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.04em] text-text-subtle">CHAT</p>
              <h1 className="mt-3 text-3xl font-medium leading-headline tracking-tight text-text-primary">
                Ask with citations.
              </h1>
              {activeSkill ? (
                <SkillModeBadge
                  skill={activeSkill}
                  onClear={() => router.push('/auth/chat', undefined, { shallow: true })}
                />
              ) : null}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto py-10">
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
                  className="mt-7 inline-flex items-center gap-1.5 rounded-md border border-dashed border-accent/40 px-3 py-1.5 text-xs text-accent transition-colors duration-140 hover:bg-accent-soft disabled:cursor-progress disabled:opacity-60"
                >
                  <Sparkles size={12} strokeWidth={1.5} />
                  {skillifying ? 'Skillifying…' : 'Skillify this thread'}
                </button>
              ) : null}
              {skillError ? (
                <p role="alert" className="mt-3 text-xs font-medium text-destructive">
                  {humanizeSkillError(skillError)}
                </p>
              ) : null}
            </div>
            <form onSubmit={submit} className="relative">
              <SlashMenu value={input} />
              <div className="flex items-end gap-3 rounded-2xl border border-border bg-white p-2">
                <textarea
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  rows={1}
                  placeholder="Ask the brain"
                  className="max-h-36 min-h-11 flex-1 resize-none rounded-input border-0 px-3 py-3 text-sm leading-body text-text-primary outline-none"
                />
                <Button type="submit">Ask</Button>
              </div>
            </form>
          </div>
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

function csrfHeaders(): HeadersInit {
  const csrf = document.cookie
    .split('; ')
    .find((part) => part.startsWith('open42_csrf='))
    ?.split('=')[1];
  return csrf ? { 'X-CSRF-Token': csrf } : {};
}

function firstQueryParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return typeof value === 'string' ? value : null;
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
