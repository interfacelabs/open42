import Head from 'next/head';
import { FormEvent, useRef, useState } from 'react';

import { CitationDetailPane } from '@/components/CitationDetailPane';
import type { ChatMessage, Citation } from '@/components/chat-types';
import { QuickSwitcher } from '@/components/QuickSwitcher';
import { Sidebar } from '@/components/Sidebar';
import { SlashMenu } from '@/components/SlashMenu';
import { Transcript } from '@/components/Transcript';
import { Button } from '@/components/ui/button';

export default function ChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const [activeCitation, setActiveCitation] = useState<Citation | null>(null);
  const currentAssistantId = useRef<string | null>(null);

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
      body: JSON.stringify({ query }),
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

  return (
    <>
      <Head>
        <title>Chat - Open42</title>
      </Head>
      <div className="flex min-h-screen overflow-hidden bg-background">
        <Sidebar />
        <main className="flex min-w-0 flex-1 flex-col px-10 py-8">
          <div className="mx-auto flex w-full max-w-chat flex-1 flex-col">
            <div>
              <p className="font-mono text-xs text-text-subtle">CHAT</p>
              <h1 className="mt-3 text-3xl font-medium tracking-tight text-text-primary">
                Ask with citations.
              </h1>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto py-10">
              <Transcript
                messages={messages}
                thinking={thinking}
                onCitationSelect={setActiveCitation}
              />
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
        <CitationDetailPane citation={activeCitation} onClose={() => setActiveCitation(null)} />
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
