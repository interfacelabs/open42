import type { ReactNode } from "react";

export function SectionEyebrow({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-md border border-line bg-surface px-2.5 py-1.5">
      <span className="text-muted-ink">{icon}</span>
      <span className="font-mono text-[14px] leading-none text-muted-ink">{children}</span>
    </div>
  );
}
