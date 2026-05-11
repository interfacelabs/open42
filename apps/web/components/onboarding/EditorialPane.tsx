import type { ReactNode } from 'react';

interface EditorialPaneProps {
  quote: ReactNode;
  attribution: string;
  illustration: ReactNode;
}

export function EditorialPane({ quote, attribution, illustration }: EditorialPaneProps) {
  return (
    <div className="hidden bg-accent-soft p-12 md:flex md:flex-col md:items-center md:justify-center md:gap-52 md:overflow-hidden md:relative">
      <div>
        <p className="font-newsreader font-normal text-[28px] leading-tight tracking-[-0.01em] text-accent-deep max-w-[22ch]">
          {quote}
        </p>
        <p className="mt-4 font-mono text-[11px] tracking-[0.06em] text-accent">
          {attribution}
        </p>
      </div>
      <div className="flex items-center justify-center min-h-[220px]">
        {illustration}
      </div>
    </div>
  );
}
