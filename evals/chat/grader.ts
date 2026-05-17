export interface ChatEvalQuestion {
  id: string;
  turns: [string, string];
  expected: string[];
}

export interface ChatEvalAnswer {
  id: string;
  answer: string;
}

export interface ChatEvalGrade {
  id: string;
  passed: boolean;
  missing: string[];
}

export function gradeChatAnswer(question: ChatEvalQuestion, answer: ChatEvalAnswer): ChatEvalGrade {
  const normalized = answer.answer.toLowerCase();
  const missing = question.expected.filter((expected) => {
    if (expected === '[1]') return /\[\d+]/.test(answer.answer);
    return !normalized.includes(expected.toLowerCase());
  });
  return {
    id: question.id,
    passed: missing.length === 0,
    missing,
  };
}
