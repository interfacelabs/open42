import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { gradeChatAnswerWithOptionalJudge, type ChatEvalQuestion } from './grader.js';

interface NormalizedMessage {
  role: 'user' | 'assistant';
  text: string;
}

const here = dirname(fileURLToPath(import.meta.url));

async function main() {
  const apiUrl = requiredEnv('OPEN42_CHAT_EVAL_API_URL').replace(/\/+$/, '');
  const workspaceId = requiredEnv('OPEN42_CHAT_EVAL_WORKSPACE_ID');
  const cookie = requiredEnv('OPEN42_CHAT_EVAL_COOKIE');
  const csrf = process.env.OPEN42_CHAT_EVAL_CSRF ?? '';
  const questions = JSON.parse(
    await readFile(join(here, 'questions.json'), 'utf8'),
  ) as ChatEvalQuestion[];
  const results = [];

  for (const question of questions) {
    const messages: NormalizedMessage[] = [];
    let finalAnswer = '';
    for (const turn of question.turns) {
      const answer = await ask({
        apiUrl,
        cookie,
        csrf,
        workspaceId,
        query: turn,
        messages,
      });
      messages.push({ role: 'user', text: turn });
      messages.push({ role: 'assistant', text: answer });
      finalAnswer = answer;
    }
    const grade = await gradeChatAnswerWithOptionalJudge(question, {
      id: question.id,
      answer: finalAnswer,
    });
    results.push({ ...grade, answer: finalAnswer });
  }

  const passed = results.filter((result) => result.passed).length;
  const summary = {
    suite: 'chat-multi-turn',
    passed,
    total: results.length,
    passThreshold: 4,
    failures: results.filter((result) => !result.passed),
  };
  console.log(JSON.stringify(summary, null, 2));
  if (passed < 4) process.exitCode = 1;
}

async function ask(input: {
  apiUrl: string;
  cookie: string;
  csrf: string;
  workspaceId: string;
  query: string;
  messages: NormalizedMessage[];
}): Promise<string> {
  const response = await fetch(`${input.apiUrl}/chat`, {
    method: 'POST',
    headers: {
      Cookie: input.cookie,
      'Content-Type': 'application/json',
      ...(input.csrf ? { 'X-CSRF-Token': input.csrf } : {}),
    },
    body: JSON.stringify({
      workspace_id: input.workspaceId,
      query: input.query,
      messages: input.messages,
    }),
  });
  if (!response.ok || !response.body) {
    throw new Error(`chat eval request failed: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line) as { type?: string; text?: string; error?: string };
      if (event.type === 'token' && event.text) text += event.text;
      if (event.type === 'error') throw new Error(event.error ?? 'chat_eval_stream_error');
    }
  }
  return text;
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for chat evals`);
  }
  return value;
}

void main();
