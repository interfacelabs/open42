import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { gradeChatAnswer, type ChatEvalAnswer, type ChatEvalQuestion } from './grader.js';
import { CHAT_EVAL_DOCS } from './seed-brain.js';

const here = dirname(fileURLToPath(import.meta.url));
const RUNS = 3;
const MIN_DOCS = 20;
const MAX_DOCS = 50;
const MIN_PASS_RATE = 0.8;
const MAX_SCORE_VARIANCE = 0.1;

const SELF_TEST_ANSWERS: Record<string, ChatEvalAnswer> = {
  'refund-monthly-followup': {
    id: 'refund-monthly-followup',
    answer: 'Monthly customers have a 14 day refund window [1].',
    citations: [{ slug: 'refund-policy' }],
  },
  'enterprise-exception-followup': {
    id: 'enterprise-exception-followup',
    answer:
      'Enterprise customers can have an exception when their signed MSA includes a custom refund clause [1].',
    citations: [{ slug: 'enterprise-msa' }],
  },
  'credit-after-window-followup': {
    id: 'credit-after-window-followup',
    answer: 'After the normal refund window, approved requests convert to account credit [1].',
    citations: [{ slug: 'billing-faq' }],
  },
  'unsupported-followup': {
    id: 'unsupported-followup',
    answer: "I don't have an office dog policy in the provided source context [1].",
    citations: [{ slug: 'refund-policy' }],
  },
  'source-aware-followup': {
    id: 'source-aware-followup',
    answer:
      'The refund-policy source says monthly customers have a 14 day refund window [1].',
    citations: [{ slug: 'refund-policy' }],
  },
};

export interface ChatEvalSelfTestSummary {
  suite: 'chat-eval-self-test';
  passed: boolean;
  runs: number;
  scores: number[];
  scoreVariance: number;
  maxAllowedScoreVariance: number;
  docCount: number;
  minDocs: number;
  maxDocs: number;
  minPassRate: number;
}

async function main() {
  const summary = await runChatEvalSelfTest();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.passed) process.exitCode = 1;
}

export async function runChatEvalSelfTest(): Promise<ChatEvalSelfTestSummary> {
  const questions = JSON.parse(
    await readFile(join(here, 'questions.json'), 'utf8'),
  ) as ChatEvalQuestion[];
  const scores = Array.from({ length: RUNS }, () => scoreFixture(questions));
  const scoreVariance = Math.max(...scores) - Math.min(...scores);
  const docCount = CHAT_EVAL_DOCS.length;

  return {
    suite: 'chat-eval-self-test',
    passed:
      docCount >= MIN_DOCS &&
      docCount <= MAX_DOCS &&
      scores.every((score) => score >= MIN_PASS_RATE) &&
      scoreVariance <= MAX_SCORE_VARIANCE,
    runs: RUNS,
    scores,
    scoreVariance,
    maxAllowedScoreVariance: MAX_SCORE_VARIANCE,
    docCount,
    minDocs: MIN_DOCS,
    maxDocs: MAX_DOCS,
    minPassRate: MIN_PASS_RATE,
  };
}

function scoreFixture(questions: ChatEvalQuestion[]): number {
  const grades = questions.map((question) => {
    const answer = SELF_TEST_ANSWERS[question.id] ?? { id: question.id, answer: '' };
    return gradeChatAnswer(question, answer);
  });
  return grades.filter((grade) => grade.passed).length / grades.length;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
