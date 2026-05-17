'use client';

import { useState, type FormEvent } from 'react';
import { WAITLIST } from '@/lib/content';

const WAITLIST_ENDPOINT = process.env.NEXT_PUBLIC_OPEN42_WAITLIST_URL ?? '';
const SUPPORT_EMAIL = 'support@open42.ai';

type Props = {
  variant?: 'light' | 'dark';
  className?: string;
};

export function EmailCaptureForm({ variant = 'light', className = '' }: Props) {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'sent' | 'error'>('idle');
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setStatus('error');
      setError(WAITLIST.invalid);
      return;
    }

    setStatus('submitting');
    setError('');

    const endpoint = resolveWaitlistEndpoint();

    if (!endpoint) {
      const body = [
        'Please add me to the Open42 private beta.',
        '',
        `Email: ${normalizedEmail}`,
      ].join('\n');
      window.location.href = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(
        'Open42 private beta access',
      )}&body=${encodeURIComponent(body)}`;
      setStatus('sent');
      return;
    }

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalizedEmail, source: 'landing' }),
      });

      if (!response.ok) throw new Error('waitlist_failed');
      setStatus('sent');
    } catch {
      setStatus('error');
      setError(WAITLIST.error);
    }
  }

  const dark = variant === 'dark';

  return (
    <form onSubmit={submit} className={className} noValidate>
      <label
        htmlFor={dark ? 'footer-beta-email' : 'hero-beta-email'}
        className={`mb-2 block font-mono text-[12px] uppercase tracking-wider ${
          dark ? 'text-white/45' : 'text-muted-ink'
        }`}
      >
        {WAITLIST.label}
      </label>
      <div
        className={`flex w-full max-w-[560px] flex-col gap-2 rounded-xl border p-1.5 shadow-[0_1px_2px_rgba(0,0,0,0.04)] sm:flex-row ${
          dark ? 'border-white/10 bg-white/[0.06]' : 'border-line bg-surface/90 backdrop-blur-sm'
        }`}
      >
        <input
          id={dark ? 'footer-beta-email' : 'hero-beta-email'}
          type="email"
          inputMode="email"
          autoComplete="email"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
            if (status === 'error') {
              setStatus('idle');
              setError('');
            }
          }}
          placeholder={WAITLIST.placeholder}
          aria-invalid={status === 'error' || undefined}
          className={`h-11 min-w-0 flex-1 rounded-lg border-0 bg-transparent px-3 font-mono text-[14px] outline-none placeholder:text-muted-ink/70 focus:ring-2 ${
            dark ? 'text-white focus:ring-white/20' : 'text-ink focus:ring-ink/10'
          }`}
        />
        <button
          type="submit"
          disabled={status === 'submitting'}
          className={`inline-flex h-11 shrink-0 items-center justify-center rounded-lg px-4 font-mono text-[14px] transition-opacity active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60 ${
            dark ? 'bg-white text-ink hover:opacity-90' : 'bg-ink text-white hover:opacity-90'
          }`}
        >
          {status === 'submitting' ? WAITLIST.submitting : WAITLIST.cta}
        </button>
      </div>
      <p
        role={status === 'error' ? 'alert' : undefined}
        className={`mt-3 min-h-[22px] font-mono text-[12px] leading-[20px] ${
          dark ? 'text-white/55' : 'text-muted-ink'
        }`}
      >
        {status === 'sent' ? WAITLIST.success : status === 'error' ? error : WAITLIST.note}
      </p>
    </form>
  );
}

function resolveWaitlistEndpoint(): string {
  if (WAITLIST_ENDPOINT) return WAITLIST_ENDPOINT;
  if (typeof window === 'undefined') return '';
  const hostname = window.location.hostname.toLowerCase();
  if (hostname === 'open42.ai' || hostname === 'www.open42.ai') {
    return 'https://api.open42.ai/waitlist';
  }
  return '';
}
