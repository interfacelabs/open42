interface IllustrationProps {
  className?: string;
}

export function CardCabinet({ className }: IllustrationProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 320 220"
      width="100%"
      style={{ maxWidth: 360 }}
      aria-hidden="true"
    >
      <g
        stroke="#1d4dff"
        strokeWidth="1.4"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="40" y="40" width="240" height="150" rx="3" />
        <rect x="50" y="52" width="220" height="28" rx="2" />
        <rect x="50" y="86" width="220" height="28" rx="2" />
        <rect x="20" y="120" width="260" height="50" rx="2" fill="#fff" />
        <line x1="60" y1="146" x2="240" y2="146" />
        <circle cx="160" cy="66" r="2.5" fill="#1d4dff" />
        <circle cx="160" cy="100" r="2.5" fill="#1d4dff" />
        <circle cx="150" cy="146" r="3" fill="#1d4dff" />
        <rect x="32" y="128" width="40" height="32" rx="1" fill="#eef1ff" />
        <rect x="78" y="128" width="40" height="32" rx="1" fill="#eef1ff" />
        <rect x="124" y="128" width="40" height="32" rx="1" fill="#eef1ff" />
        <rect x="170" y="128" width="40" height="32" rx="1" fill="#eef1ff" />
        <rect x="216" y="128" width="40" height="32" rx="1" fill="#eef1ff" />
      </g>
      <g fontFamily="var(--font-geist-mono), monospace" fontSize="8" fill="#1d4dff" opacity="0.85">
        <text x="38" y="144">runbk</text>
        <text x="84" y="144">brand</text>
        <text x="130" y="144">notion</text>
        <text x="176" y="144">slack</text>
        <text x="222" y="144">drive</text>
      </g>
    </svg>
  );
}
