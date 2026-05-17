import { describe, expect, it, vi } from 'vitest';

import {
  AnthropicChatAdapter,
  OpenAIChatAdapter,
  type NormalizedMessage,
} from './chat-providers.js';

const messages: NormalizedMessage[] = [
  { role: 'user', content: 'What is the refund policy?' },
  { role: 'assistant', content: 'Annual customers have a 30 day window [1].' },
  { role: 'user', content: 'Context:\n[1] slug=refund-policy version=v1 updated=now\nMonthly differs.' },
  { role: 'user', content: 'Question: What about monthly customers?' },
];

describe('AnthropicChatAdapter', () => {
  it('streams text deltas and applies cache markers only inside the Anthropic request', async () => {
    const requests: Array<Record<string, unknown>> = [];
    const adapter = new AnthropicChatAdapter({
      clientFactory: () => ({
        messages: {
          stream(params: Record<string, unknown>) {
            requests.push(params);
            return (async function* () {
              yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hello' } };
              yield { type: 'message_stop' };
            })();
          },
        },
      }),
      env: { ANTHROPIC_MODEL: 'claude-test' } as NodeJS.ProcessEnv,
    });

    await expect(
      collect(
        adapter.sendStreamingChat({
          systemPrompt: 'system',
          messages,
          resolvedKey: { apiKey: 'sk-ant-real', source: 'tenant', model: null },
        }),
      ),
    ).resolves.toEqual(['hello']);

    const request = requests[0];
    expect(request?.model).toBe('claude-test');
    expect(request?.system).toEqual([
      { type: 'text', text: 'system', cache_control: { type: 'ephemeral' } },
    ]);

    const anthropicMessages = request?.messages as Array<{
      content: Array<{ text: string; cache_control?: { type: string } }>;
    }>;
    expect(anthropicMessages[0]?.content[0]?.cache_control).toEqual({ type: 'ephemeral' });
    expect(anthropicMessages[1]?.content[0]?.cache_control).toEqual({ type: 'ephemeral' });
    expect(anthropicMessages[2]?.content[0]?.cache_control).toBeUndefined();
    expect(anthropicMessages[3]?.content[0]?.cache_control).toBeUndefined();
  });
});

describe('OpenAIChatAdapter', () => {
  it('posts a streaming chat completion and yields SSE deltas without cache markers', async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), init: init ?? {} });
      return new Response(
        streamFromString(
          [
            'data: {"choices":[{"delta":{"content":"hello "}}]}',
            '',
            'data: {"choices":[{"delta":{"content":"world"}}]}',
            '',
            'data: [DONE]',
            '',
          ].join('\n'),
        ),
        { status: 200 },
      );
    });
    const adapter = new OpenAIChatAdapter({
      fetch: fetch as unknown as typeof globalThis.fetch,
      env: { OPENAI_MODEL: 'gpt-test' } as NodeJS.ProcessEnv,
    });

    await expect(
      collect(
        adapter.sendStreamingChat({
          systemPrompt: 'system',
          messages,
          resolvedKey: { apiKey: 'sk-openai-real', source: 'tenant', model: null },
        }),
      ),
    ).resolves.toEqual(['hello ', 'world']);

    const request = requests[0];
    expect(request?.url).toBe('https://api.openai.com/v1/chat/completions');
    const body = JSON.parse(String(request?.init.body));
    expect(body).toMatchObject({ model: 'gpt-test', stream: true });
    expect(body.messages).toEqual([
      { role: 'system', content: 'system' },
      ...messages,
    ]);
    expect(JSON.stringify(body)).not.toContain('cache_control');
  });
});

async function collect(stream: AsyncIterable<{ text: string }>): Promise<string[]> {
  const out: string[] = [];
  for await (const token of stream) out.push(token.text);
  return out;
}

function streamFromString(value: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(value));
      controller.close();
    },
  });
}
