import { create } from 'zustand';

import type { ChatMessage, Citation } from '@open42/shared-types';

interface ChatState {
  messages: ChatMessage[];
  sending: boolean;
  activeCitation: Citation | null;
  setMessages: (messages: ChatMessage[]) => void;
  appendMessage: (message: ChatMessage) => void;
  updateMessage: (id: string, patch: Partial<ChatMessage>) => void;
  appendToken: (id: string, text: string) => void;
  setSending: (sending: boolean) => void;
  setActiveCitation: (citation: Citation | null) => void;
  clear: () => void;
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  sending: false,
  activeCitation: null,
  setMessages: (messages) => set({ messages }),
  appendMessage: (message) => set((state) => ({ messages: [...state.messages, message] })),
  updateMessage: (id, patch) =>
    set((state) => ({
      messages: state.messages.map((message) =>
        message.id === id ? { ...message, ...patch } : message
      ),
    })),
  appendToken: (id, text) =>
    set((state) => ({
      messages: state.messages.map((message) =>
        message.id === id ? { ...message, text: `${message.text}${text}` } : message
      ),
    })),
  setSending: (sending) => set({ sending }),
  setActiveCitation: (citation) => set({ activeCitation: citation }),
  clear: () => set({ messages: [], sending: false, activeCitation: null }),
}));
