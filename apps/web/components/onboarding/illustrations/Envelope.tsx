interface IllustrationProps {
  className?: string;
}

export function Envelope({ className }: IllustrationProps) {
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
        <rect x="60" y="70" width="200" height="120" rx="4" />
        <path d="M 60 70 L 160 140 L 260 70" />
        <text
          x="160"
          y="170"
          textAnchor="middle"
          fontFamily="var(--font-geist-mono), monospace"
          fontSize="20"
          fill="#1d4dff"
          stroke="none"
          letterSpacing="4"
        >
          * * * * * *
        </text>
      </g>
    </svg>
  );
}
