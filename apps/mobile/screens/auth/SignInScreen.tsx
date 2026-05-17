import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, TextInput, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { AppText } from '@/components/ui/Text';
import { TextField } from '@/components/ui/TextField';
import { useAuthStore } from '@/store/auth';
import { apiFetch } from '@/utils/api';
import { apiErrorCode, humanizeError } from '@/utils/errors';
import type { RootStackParamList } from '@/navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'SignIn'>;

type SignInState = 'idle' | 'submitting' | 'sent' | 'verifying' | 'error';

const RESEND_COOLDOWN_SECONDS = 30;

export function SignInScreen({ navigation }: Props) {
  const restoreSession = useAuthStore((state) => state.restoreSession);
  const [email, setEmail] = useState('');
  const [digits, setDigits] = useState<string[]>(() => Array(6).fill(''));
  const [state, setState] = useState<SignInState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const inputsRef = useRef<(TextInput | null)[]>([]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const id = setInterval(() => setResendIn((value) => (value <= 1 ? 0 : value - 1)), 1000);
    return () => clearInterval(id);
  }, [resendIn]);

  async function sendCode() {
    if (!email.trim()) return;
    setState('submitting');
    setError(null);
    try {
      await apiFetch('/auth/signin', {
        method: 'POST',
        body: { email: email.trim() },
      });
      setDigits(Array(6).fill(''));
      setResendIn(RESEND_COOLDOWN_SECONDS);
      setState('sent');
      queueMicrotask(() => inputsRef.current[0]?.focus());
    } catch (err) {
      setError(apiErrorCode(err));
      setState('error');
    }
  }

  async function verify(nextDigits = digits) {
    const token = nextDigits.join('');
    if (token.length !== 6 || state === 'verifying') return;
    setState('verifying');
    setError(null);
    try {
      await apiFetch('/auth/verify', {
        method: 'POST',
        body: { email: email.trim(), token, type: 'email' },
      });
      await restoreSession();
    } catch (err) {
      setError(apiErrorCode(err));
      setState('sent');
    }
  }

  function updateDigit(index: number, value: string) {
    const digit = value.replace(/\D/g, '').slice(-1);
    const next = digits.slice();
    next[index] = digit;
    setDigits(next);
    if (digit && index < 5) inputsRef.current[index + 1]?.focus();
    if (next.every((item) => item.length === 1)) void verify(next);
  }

  const sent = state === 'sent' || state === 'verifying';

  return (
    <KeyboardAvoidingView
      behavior={Platform.select({ ios: 'padding', default: undefined })}
      style={{ flex: 1 }}>
      <Screen scroll={false}>
        <View className="flex-1 justify-center">
          <AppText variant="caption" tone="primary" weight="medium">
            open42
          </AppText>
          <AppText variant="display" style={{ marginTop: 28 }}>
            Your brain, with receipts.
          </AppText>
          <AppText variant="muted" tone="subtle" style={{ marginTop: 12 }}>
            Sign in with the same email you use on the web. We will send a six digit code.
          </AppText>

          <View className="mt-8 gap-3">
            <TextField
              value={email}
              editable={!sent && state !== 'submitting'}
              inputMode="email"
              keyboardType="email-address"
              placeholder="you@company.com"
              textContentType="emailAddress"
              onChangeText={setEmail}
              onSubmitEditing={() => void sendCode()}
            />
            {!sent ? (
              <Button loading={state === 'submitting'} onPress={() => void sendCode()}>
                {state === 'submitting' ? 'Sending' : 'Send code'}
              </Button>
            ) : (
              <>
                <View className="flex-row gap-2">
                  {digits.map((digit, index) => (
                    <TextField
                      key={index}
                      ref={(node) => {
                        inputsRef.current[index] = node;
                      }}
                      value={digit}
                      className="flex-1 text-center"
                      keyboardType="number-pad"
                      maxLength={1}
                      selectTextOnFocus
                      onChangeText={(value) => updateDigit(index, value)}
                    />
                  ))}
                </View>
                <Button loading={state === 'verifying'} onPress={() => void verify()}>
                  {state === 'verifying' ? 'Checking' : 'Verify code'}
                </Button>
                <View className="flex-row items-center justify-between">
                  <Pressable disabled={resendIn > 0} onPress={() => void sendCode()}>
                    <AppText
                      variant="caption"
                      tone={resendIn > 0 ? 'faint' : 'accent'}
                      weight="medium">
                      {resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend code'}
                    </AppText>
                  </Pressable>
                  <Pressable onPress={() => setState('idle')}>
                    <AppText variant="caption" tone="subtle" weight="medium">
                      Edit email
                    </AppText>
                  </Pressable>
                </View>
              </>
            )}
            {error ? (
              <AppText variant="caption" tone="error" accessibilityRole="alert">
                {humanizeError(error)}
              </AppText>
            ) : null}
          </View>
        </View>
        <Pressable onPress={() => navigation.navigate('VerifyDeepLink', {})}>
          <AppText variant="caption" tone="faint" style={{ textAlign: 'center' }}>
            Open a magic-link URL manually
          </AppText>
        </Pressable>
      </Screen>
    </KeyboardAvoidingView>
  );
}
