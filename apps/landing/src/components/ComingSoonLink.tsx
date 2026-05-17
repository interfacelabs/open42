'use client';

import { useEffect, useRef, useState } from 'react';

type Props = {
  className?: string;
  children: React.ReactNode;
  ariaLabel?: string;
  message?: string;
  badge?: string;
};

export function ComingSoonLink({
  className,
  children,
  ariaLabel,
  message = 'Coming soon',
  badge = 'Soon',
}: Props) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <span
      ref={wrapperRef}
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label={ariaLabel}
        aria-disabled="true"
        onClick={(e) => {
          e.preventDefault();
          setOpen((v) => !v);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className={className}
      >
        <span className="inline-flex items-center gap-1.5">
          <span>{children}</span>
          {badge ? (
            <span className="rounded-full border border-line bg-surface px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-ink">
              {badge}
            </span>
          ) : null}
        </span>
      </button>
      <span
        role="tooltip"
        aria-hidden={!open}
        className={
          'pointer-events-none absolute -top-2 left-1/2 z-50 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border border-line bg-surface px-2 py-1 font-mono text-[11px] text-ink shadow-[0_8px_24px_-12px_rgba(0,0,0,0.25)] transition-opacity duration-150 ' +
          (open ? 'opacity-100' : 'opacity-0')
        }
      >
        {message}
      </span>
    </span>
  );
}
