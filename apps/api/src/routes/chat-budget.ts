const DEFAULT_CHAT_REQUESTS_PER_MINUTE = 20;
const DEFAULT_CHAT_INPUT_CHARS_PER_MINUTE = 40_000;
const CHAT_WINDOW_MS = 60_000;
const APPROX_CHARS_PER_TOKEN = 4;

export interface TokenCountMessage {
  content: string;
}

interface ChatBudgetEntry {
  requests: number;
  inputChars: number;
  resetAt: number;
}

export interface ChatBudgetInput {
  workspaceId: string;
  inputChars: number;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
}

export type ChatBudgetResult =
  | { ok: true; remainingRequests: number; remainingInputChars: number }
  | { ok: false; error: 'chat_rate_limited' | 'chat_budget_exceeded'; retryAfter: number };

const workspaceChatBudget = new Map<string, ChatBudgetEntry>();

export function checkWorkspaceChatBudget(input: ChatBudgetInput): ChatBudgetResult {
  const env = input.env ?? process.env;
  const now = input.now?.() ?? Date.now();
  const requestLimit = positiveInt(
    env.OPEN42_CHAT_RATE_LIMIT_PER_MINUTE,
    DEFAULT_CHAT_REQUESTS_PER_MINUTE,
  );
  const inputCharLimit = positiveInt(
    env.OPEN42_CHAT_INPUT_CHARS_PER_MINUTE,
    DEFAULT_CHAT_INPUT_CHARS_PER_MINUTE,
  );
  const existing = workspaceChatBudget.get(input.workspaceId);
  const entry =
    existing && existing.resetAt > now
      ? existing
      : { requests: 0, inputChars: 0, resetAt: now + CHAT_WINDOW_MS };

  if (entry.requests + 1 > requestLimit) {
    workspaceChatBudget.set(input.workspaceId, entry);
    return {
      ok: false,
      error: 'chat_rate_limited',
      retryAfter: secondsUntil(entry.resetAt, now),
    };
  }

  if (entry.inputChars + input.inputChars > inputCharLimit) {
    workspaceChatBudget.set(input.workspaceId, entry);
    return {
      ok: false,
      error: 'chat_budget_exceeded',
      retryAfter: secondsUntil(entry.resetAt, now),
    };
  }

  entry.requests += 1;
  entry.inputChars += input.inputChars;
  workspaceChatBudget.set(input.workspaceId, entry);
  return {
    ok: true,
    remainingRequests: requestLimit - entry.requests,
    remainingInputChars: inputCharLimit - entry.inputChars,
  };
}

export function resetWorkspaceChatBudgetForTest(): void {
  workspaceChatBudget.clear();
}

export function countTokensInMessages(messages: TokenCountMessage[]): number {
  return messages.reduce((sum, message) => sum + approximateTokenCount(message.content), 0);
}

export function approximateTokenCount(text: string): number {
  const normalized = text.trim();
  if (!normalized) return 0;
  return Math.ceil(normalized.length / APPROX_CHARS_PER_TOKEN);
}

function positiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function secondsUntil(resetAt: number, now: number): number {
  return Math.max(1, Math.ceil((resetAt - now) / 1000));
}
