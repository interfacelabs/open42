import Anthropic from '@anthropic-ai/sdk';

import type { LlmProvider, ResolvedLlmKey } from '../auth/llm-keys.js';

const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-6';
const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';
const OPENAI_CHAT_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions';
const MAX_ANTHROPIC_MESSAGE_CACHE_BREAKPOINTS = 3;

export type NormalizedChatRole = 'user' | 'assistant';

export interface NormalizedMessage {
  role: NormalizedChatRole;
  content: string;
}

export interface ChatProviderInput {
  systemPrompt: string;
  messages: NormalizedMessage[];
  resolvedKey: ResolvedLlmKey;
  maxTokens?: number;
}

export interface ChatToken {
  text: string;
}

export interface ChatProvider {
  readonly provider: LlmProvider;
  sendStreamingChat(input: ChatProviderInput): AsyncIterable<ChatToken>;
}

export class ChatProviderError extends Error {
  readonly provider: LlmProvider;
  readonly code: string;

  constructor(provider: LlmProvider, code: string, message: string) {
    super(message);
    this.name = 'ChatProviderError';
    this.provider = provider;
    this.code = code;
  }
}

type AnthropicClient = {
  messages: {
    stream: (params: Record<string, unknown>) => AsyncIterable<unknown>;
  };
};

export interface AnthropicChatAdapterDeps {
  clientFactory?: (apiKey: string) => AnthropicClient;
  env?: NodeJS.ProcessEnv;
}

export class AnthropicChatAdapter implements ChatProvider {
  readonly provider = 'anthropic' as const;
  private readonly clientFactory: (apiKey: string) => AnthropicClient;
  private readonly env: NodeJS.ProcessEnv;

  constructor(deps: AnthropicChatAdapterDeps = {}) {
    this.clientFactory =
      deps.clientFactory ?? ((apiKey) => new Anthropic({ apiKey }) as unknown as AnthropicClient);
    this.env = deps.env ?? process.env;
  }

  async *sendStreamingChat(input: ChatProviderInput): AsyncIterable<ChatToken> {
    const client = this.clientFactory(input.resolvedKey.apiKey);
    const cacheableMessageIndexes = anthropicCacheMessageIndexes(input.messages);
    const stream = client.messages.stream({
      model: pickModel(input.resolvedKey, this.env.ANTHROPIC_MODEL, DEFAULT_ANTHROPIC_MODEL),
      max_tokens: input.maxTokens ?? 700,
      system: [
        {
          type: 'text',
          text: input.systemPrompt,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: input.messages.map((message, index) => ({
        role: message.role,
        content: [
          {
            type: 'text',
            text: message.content,
            ...(cacheableMessageIndexes.has(index)
              ? { cache_control: { type: 'ephemeral' } }
              : {}),
          },
        ],
      })),
    });

    try {
      for await (const event of stream) {
        const token = tokenFromAnthropicEvent(event);
        if (token) yield { text: token };
      }
    } catch (err) {
      throw new ChatProviderError(
        this.provider,
        'provider_stream_failed',
        err instanceof Error ? err.message : String(err),
      );
    }
  }
}

export interface OpenAIChatAdapterDeps {
  fetch?: typeof fetch;
  env?: NodeJS.ProcessEnv;
}

export class OpenAIChatAdapter implements ChatProvider {
  readonly provider = 'openai' as const;
  private readonly fetchImpl: typeof fetch;
  private readonly env: NodeJS.ProcessEnv;

  constructor(deps: OpenAIChatAdapterDeps = {}) {
    this.fetchImpl = deps.fetch ?? fetch;
    this.env = deps.env ?? process.env;
  }

  async *sendStreamingChat(input: ChatProviderInput): AsyncIterable<ChatToken> {
    const response = await this.fetchImpl(OPENAI_CHAT_COMPLETIONS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.resolvedKey.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: pickModel(input.resolvedKey, this.env.OPENAI_MODEL, DEFAULT_OPENAI_MODEL),
        max_tokens: input.maxTokens ?? 700,
        stream: true,
        messages: [
          { role: 'system', content: input.systemPrompt },
          ...input.messages.map((message) => ({
            role: message.role,
            content: message.content,
          })),
        ],
      }),
    });

    if (!response.ok) {
      throw new ChatProviderError(
        this.provider,
        'provider_request_failed',
        `OpenAI chat request failed with ${response.status}`,
      );
    }
    if (!response.body) {
      throw new ChatProviderError(this.provider, 'provider_stream_missing', 'OpenAI stream missing');
    }

    try {
      for await (const event of readOpenAISse(response.body)) {
        const text = event.choices?.[0]?.delta?.content;
        if (typeof text === 'string' && text) yield { text };
      }
    } catch (err) {
      if (err instanceof ChatProviderError) throw err;
      throw new ChatProviderError(
        this.provider,
        'provider_stream_failed',
        err instanceof Error ? err.message : String(err),
      );
    }
  }
}

export function createChatProvider(provider: LlmProvider): ChatProvider {
  return provider === 'openai' ? new OpenAIChatAdapter() : new AnthropicChatAdapter();
}

function pickModel(
  resolvedKey: ResolvedLlmKey,
  envModel: string | undefined,
  fallback: string,
): string {
  return resolvedKey.model?.trim() || envModel?.trim() || fallback;
}

function anthropicCacheMessageIndexes(messages: NormalizedMessage[]): Set<number> {
  // The route appends the latest context block and latest question as the last
  // two adjacent user messages. Everything before that is replayed history and
  // is stable enough to mark as prompt-cacheable for Anthropic only. The system
  // prompt already uses one explicit cache breakpoint, so cap message
  // breakpoints at three to stay inside Anthropic's four-breakpoint limit.
  const stableMessageCount = Math.max(0, messages.length - 2);
  if (stableMessageCount <= MAX_ANTHROPIC_MESSAGE_CACHE_BREAKPOINTS) {
    return new Set(Array.from({ length: stableMessageCount }, (_, index) => index));
  }

  const indexes = new Set<number>();
  indexes.add(stableMessageCount - 1);
  indexes.add(Math.max(0, stableMessageCount - 21));
  indexes.add(Math.max(0, stableMessageCount - 41));
  return indexes;
}

function tokenFromAnthropicEvent(event: unknown): string | null {
  const maybe = event as {
    type?: unknown;
    delta?: { type?: unknown; text?: unknown };
  };
  if (maybe.type === 'content_block_delta' && maybe.delta?.type === 'text_delta') {
    return typeof maybe.delta.text === 'string' ? maybe.delta.text : null;
  }
  return null;
}

async function* readOpenAISse(body: ReadableStream<Uint8Array>): AsyncIterable<{
  choices?: Array<{ delta?: { content?: string } }>;
}> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const parsed = parseOpenAIFrame(frame);
      if (parsed === 'done') return;
      if (parsed) yield parsed;
      boundary = buffer.indexOf('\n\n');
    }
  }

  buffer += decoder.decode();
  const parsed = parseOpenAIFrame(buffer);
  if (parsed && parsed !== 'done') yield parsed;
}

function parseOpenAIFrame(
  frame: string,
): { choices?: Array<{ delta?: { content?: string } }> } | 'done' | null {
  const dataLines = frame
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice('data:'.length).trim());
  if (dataLines.length === 0) return null;

  const data = dataLines.join('\n');
  if (data === '[DONE]') return 'done';
  try {
    return JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> };
  } catch {
    throw new ChatProviderError('openai', 'provider_stream_parse_failed', 'Invalid OpenAI SSE frame');
  }
}
