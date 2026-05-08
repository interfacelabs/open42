import { useEffect, useRef } from 'react';

export function sizeForLength(len: number): number {
  if (len === 0) return 22;
  if (len <= 14) return 26;
  if (len <= 24) return 22;
  if (len <= 36) return 18;
  return 16;
}

interface NameplateProps {
  value: string;
}

export function Nameplate({ value }: NameplateProps) {
  const trimmed = value.trim();
  const isEmpty = trimmed.length === 0;
  const display = isEmpty ? 'your brain' : trimmed;
  const fontSize = sizeForLength(trimmed.length);
  const underlineWidth = Math.max(60, Math.min(220, trimmed.length * 9));
  const minHeight = trimmed.length > 14 ? 130 : 110;

  const textRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    el.classList.remove('np-flash');
    void el.offsetWidth;
    el.classList.add('np-flash');
  }, [value]);

  return (
    <div className="flex items-center justify-center min-h-[220px]">
      <div
        className="relative flex items-center justify-center bg-white border border-accent rounded-md px-7 py-6 transition-[min-height] duration-200"
        style={{ width: 320, minHeight }}
      >
        <span className="absolute top-1.5 left-1.5 w-1.5 h-1.5 rounded-full bg-accent" />
        <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-accent" />
        <span className="absolute bottom-1.5 left-1.5 w-1.5 h-1.5 rounded-full bg-accent" />
        <span className="absolute bottom-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-accent" />
        <div
          ref={textRef}
          className={`font-newsreader italic text-center leading-snug transition-[font-size] duration-200 ${
            isEmpty ? 'text-text-faint opacity-55' : 'text-accent-deep'
          }`}
          style={{ fontSize, wordBreak: 'normal', overflowWrap: 'anywhere' }}
        >
          {display}
        </div>
        <div
          className="absolute bottom-4 left-1/2 -translate-x-1/2 h-px bg-accent opacity-35 rounded transition-[width] duration-250"
          style={{ width: underlineWidth }}
        />
      </div>
    </div>
  );
}
