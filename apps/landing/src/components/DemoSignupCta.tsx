import { DEMO_ACCESS } from '@/lib/content';
import { ChevronRight } from '@/components/icons';

const APP_SIGN_IN_URL = `${(
  process.env.NEXT_PUBLIC_OPEN42_APP_URL ?? 'https://app.open42.ai'
).replace(/\/+$/, '')}/sign_in`;

type Props = {
  variant?: 'light' | 'dark';
  className?: string;
};

export function DemoSignupCta({ variant = 'light', className = '' }: Props) {
  const dark = variant === 'dark';

  return (
    <div className={className}>
      <div
        className={`flex w-full max-w-[560px] flex-col gap-3 rounded-xl border p-2 shadow-[0_1px_2px_rgba(0,0,0,0.04)] sm:flex-row sm:items-center ${
          dark ? 'border-white/10 bg-white/[0.06]' : 'border-line bg-surface/90 backdrop-blur-sm'
        }`}
      >
        <a
          href={APP_SIGN_IN_URL}
          className={`inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-lg px-4 font-mono text-[14px] transition-opacity active:translate-y-px ${
            dark ? 'bg-white text-ink hover:opacity-90' : 'bg-ink text-white hover:opacity-90'
          }`}
        >
          {DEMO_ACCESS.cta}
          <ChevronRight className="h-3.5 w-3.5" />
        </a>
        <p
          className={`font-mono text-[12px] leading-[20px] ${
            dark ? 'text-white/60' : 'text-muted-ink'
          }`}
        >
          {DEMO_ACCESS.note}{' '}
          <span className={dark ? 'text-white/45' : 'text-muted-ink/80'}>
            {DEMO_ACCESS.disclaimer}
          </span>
        </p>
      </div>
    </div>
  );
}
