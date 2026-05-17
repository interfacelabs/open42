import { afterEach, describe, expect, it } from 'vitest';

import {
  checkWorkspaceChatBudget,
  countTokensInMessages,
  resetWorkspaceChatBudgetForTest,
} from './chat-budget.js';

describe('checkWorkspaceChatBudget', () => {
  afterEach(() => {
    resetWorkspaceChatBudgetForTest();
  });

  it('rate limits per workspace in a rolling one-minute window', () => {
    const env = { OPEN42_CHAT_RATE_LIMIT_PER_MINUTE: '1' } as NodeJS.ProcessEnv;
    const now = () => 1_000;
    expect(checkWorkspaceChatBudget({ workspaceId: 'w1', inputChars: 10, env, now }).ok).toBe(true);
    expect(checkWorkspaceChatBudget({ workspaceId: 'w1', inputChars: 10, env, now })).toEqual({
      ok: false,
      error: 'chat_rate_limited',
      retryAfter: 60,
    });
    expect(checkWorkspaceChatBudget({ workspaceId: 'w2', inputChars: 10, env, now }).ok).toBe(true);
  });

  it('enforces an input character budget per workspace', () => {
    const env = { OPEN42_CHAT_INPUT_CHARS_PER_MINUTE: '12' } as NodeJS.ProcessEnv;
    const now = () => 1_000;
    expect(checkWorkspaceChatBudget({ workspaceId: 'w1', inputChars: 10, env, now }).ok).toBe(true);
    expect(checkWorkspaceChatBudget({ workspaceId: 'w1', inputChars: 3, env, now })).toEqual({
      ok: false,
      error: 'chat_budget_exceeded',
      retryAfter: 60,
    });
  });

  it('resets after the window expires', () => {
    const env = { OPEN42_CHAT_RATE_LIMIT_PER_MINUTE: '1' } as NodeJS.ProcessEnv;
    let time = 1_000;
    const now = () => time;
    expect(checkWorkspaceChatBudget({ workspaceId: 'w1', inputChars: 10, env, now }).ok).toBe(true);
    time += 60_001;
    expect(checkWorkspaceChatBudget({ workspaceId: 'w1', inputChars: 10, env, now }).ok).toBe(true);
  });

  it('counts approximate tokens across normalized messages', () => {
    expect(
      countTokensInMessages([
        { content: 'abcd' },
        { content: 'abcde' },
        { content: '   ' },
      ]),
    ).toBe(3);
  });
});
