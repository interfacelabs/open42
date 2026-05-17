import { useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from 'react-native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { ArrowUp } from 'lucide-react-native';

import type { Citation } from '@open42/shared-types';

import { CitationDetailSheet } from '@/components/chat/CitationDetailSheet';
import { Transcript } from '@/components/chat/Transcript';
import { EmptyState } from '@/components/EmptyState';
import { AppText } from '@/components/ui/Text';
import type { MainTabParamList } from '@/navigation/types';
import { useAuthStore } from '@/store/auth';
import { useChatStore } from '@/store/chat';
import { newId } from '@/utils/ids';
import { consumeNdjson, rawApiFetch } from '@/utils/api';
import { colors, fonts } from '@/utils/theme';

type Props = BottomTabScreenProps<MainTabParamList, 'ChatTab'>;

type StreamEvent =
  | { type: 'citations'; citations: Citation[] }
  | { type: 'token'; text: string }
  | { type: 'error'; error: string }
  | { type: 'done' };

export function ChatScreen({ route }: Props) {
  const workspaceId = useAuthStore((state) => state.currentWorkspaceId);
  const messages = useChatStore((state) => state.messages);
  const sending = useChatStore((state) => state.sending);
  const activeCitation = useChatStore((state) => state.activeCitation);
  const setActiveCitation = useChatStore((state) => state.setActiveCitation);
  const appendMessage = useChatStore((state) => state.appendMessage);
  const updateMessage = useChatStore((state) => state.updateMessage);
  const appendToken = useChatStore((state) => state.appendToken);
  const setSending = useChatStore((state) => state.setSending);
  const [input, setInput] = useState('');
  const scrollRef = useRef<ScrollView | null>(null);
  const tokenBufferRef = useRef('');
  const tokenFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeSkillId = route.params?.skillId;

  async function send(query: string, retryAssistantId?: string) {
    const trimmed = query.trim();
    if (!trimmed || !workspaceId || sending) return;
    const history = messages
      .filter(
        (message) =>
          (message.role === 'user' || message.role === 'assistant') &&
          message.id !== retryAssistantId &&
          !message.error &&
          message.text.trim().length > 0
      )
      .slice(-20)
      .map((message) => ({ role: message.role, text: message.text }));
    const assistantId = retryAssistantId ?? newId('assistant');
    if (retryAssistantId) {
      updateMessage(assistantId, {
        text: '',
        citations: [],
        error: undefined,
        retryQuery: trimmed,
      });
    } else {
      appendMessage({ id: newId('user'), role: 'user', text: trimmed });
      appendMessage({
        id: assistantId,
        role: 'assistant',
        text: '',
        citations: [],
        retryQuery: trimmed,
      });
    }
    setInput('');
    setSending(true);
    queueMicrotask(() => scrollRef.current?.scrollToEnd({ animated: true }));

    try {
      const response = await rawApiFetch('/chat', {
        method: 'POST',
        reactNative: { textStreaming: true },
        body: {
          query: trimmed,
          messages: history,
          workspace_id: workspaceId,
          ...(activeSkillId ? { skillId: activeSkillId } : {}),
        },
      });
      if (!response.ok) {
        updateMessage(assistantId, { text: '', error: 'chat_provider_error', retryQuery: trimmed });
        return;
      }
      await consumeNdjson<StreamEvent>(response, (event) => {
        if (event.type === 'citations') updateMessage(assistantId, { citations: event.citations });
        if (event.type === 'token') queueTokenFlush(assistantId, event.text);
        if (event.type === 'error') updateMessage(assistantId, { text: '', error: event.error });
        if (event.type === 'done') flushTokens(assistantId);
        queueMicrotask(() => scrollRef.current?.scrollToEnd({ animated: true }));
      });
      flushTokens(assistantId);
    } catch {
      flushTokens(assistantId);
      updateMessage(assistantId, { text: '', error: 'network_error', retryQuery: trimmed });
    } finally {
      setSending(false);
    }
  }

  function retry(messageId: string) {
    const message = messages.find((item) => item.id === messageId);
    if (message?.retryQuery) void send(message.retryQuery, messageId);
  }

  function queueTokenFlush(assistantId: string, token: string) {
    tokenBufferRef.current += token;
    if (tokenFlushTimerRef.current) return;
    tokenFlushTimerRef.current = setTimeout(() => {
      tokenFlushTimerRef.current = null;
      flushTokens(assistantId);
    }, 16);
  }

  function flushTokens(assistantId: string) {
    if (tokenFlushTimerRef.current) {
      clearTimeout(tokenFlushTimerRef.current);
      tokenFlushTimerRef.current = null;
    }
    const text = tokenBufferRef.current;
    if (!text) return;
    tokenBufferRef.current = '';
    appendToken(assistantId, text);
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.select({ ios: 'padding', default: undefined })}
      style={{ backgroundColor: colors.bg, flex: 1 }}
      keyboardVerticalOffset={84}>
      <View className="flex-1">
        <ScrollView
          ref={scrollRef}
          className="flex-1"
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 20, paddingTop: 24 }}
          keyboardShouldPersistTaps="handled">
          {activeSkillId ? (
            <View className="mb-4 rounded-full border border-accent bg-accent-soft px-3 py-2">
              <AppText variant="caption" tone="accent" weight="medium">
                Skill mode · {route.params?.skillName ?? 'selected skill'}
              </AppText>
            </View>
          ) : null}
          {messages.length === 0 ? (
            <EmptyState
              eyebrow="ASK"
              title="Ask the brain."
              body="Every answer arrives with citation chips. Tap a chip to inspect the source excerpt."
            />
          ) : (
            <Transcript
              messages={messages}
              thinking={sending}
              activeCitation={activeCitation}
              onCitation={setActiveCitation}
              onRetry={retry}
            />
          )}
        </ScrollView>
        <View className="border-t border-border bg-surface px-4 pb-3 pt-3">
          <View className="flex-row items-end gap-2 rounded-[24px] border border-border bg-surface py-2 pl-4 pr-2">
            <TextInput
              value={input}
              multiline
              placeholder="Ask the brain..."
              placeholderTextColor={colors.textFaint}
              style={{
                color: colors.textPrimary,
                flex: 1,
                fontFamily: fonts.sans,
                fontSize: 15,
                maxHeight: 132,
                minHeight: 34,
              }}
              onChangeText={setInput}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Send"
              disabled={!input.trim() || sending}
              className="h-10 w-10 items-center justify-center rounded-full"
              style={{
                backgroundColor:
                  input.trim() && !sending ? colors.textPrimary : colors.surfaceMuted,
              }}
              onPress={() => void send(input)}>
              <ArrowUp
                color={input.trim() && !sending ? colors.surface : colors.textFaint}
                size={17}
                strokeWidth={1.5}
              />
            </Pressable>
          </View>
          <AppText variant="caption" tone="faint" style={{ marginTop: 7, textAlign: 'center' }}>
            Every answer cites its source.
          </AppText>
        </View>
      </View>
      <CitationDetailSheet citation={activeCitation} onClose={() => setActiveCitation(null)} />
    </KeyboardAvoidingView>
  );
}
