import type { ChatMessage } from '@/components/chat-types';

const MAX_PRIOR_TURNS = 20;
const MAX_PRIOR_MESSAGES = MAX_PRIOR_TURNS * 2;

export interface ChatRequestHistoryMessage {
  role: 'user' | 'assistant';
  text: string;
}

export function buildChatRequestHistory(
  messages: ChatMessage[],
  retryAssistantId?: string,
): ChatRequestHistoryMessage[] {
  const retryAssistantIndex = retryAssistantId
    ? messages.findIndex((message) => message.id === retryAssistantId)
    : -1;
  const retryUserIndex =
    retryAssistantIndex > 0 && messages[retryAssistantIndex - 1]?.role === 'user'
      ? retryAssistantIndex - 1
      : -1;

  const history: ChatRequestHistoryMessage[] = [];
  for (const [index, message] of messages.entries()) {
    if (message.role !== 'user' && message.role !== 'assistant') continue;
    if (retryAssistantId && message.id === retryAssistantId) continue;
    if (index === retryUserIndex) continue;
    if (message.error) continue;
    if (!message.text.trim()) continue;
    history.push({ role: message.role, text: message.text });
  }
  return history.slice(-MAX_PRIOR_MESSAGES);
}
