interface IllustrationProps {
  className?: string;
}

export function EmptyShelf({ className }: IllustrationProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 320 220"
      width="100%"
      style={{ maxWidth: 340 }}
      aria-hidden="true"
    >
      <g
        stroke="#1d4dff"
        strokeWidth="1.4"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <line x1="40" y1="50" x2="280" y2="50" />
        <line x1="40" y1="110" x2="280" y2="110" />
        <line x1="40" y1="170" x2="280" y2="170" />
        <rect
          x="50"
          y="78"
          width="14"
          height="32"
          rx="1"
          transform="rotate(-12 57 94)"
          fill="#fff"
        />
      </g>
      <g fontFamily="var(--font-geist-mono), monospace" fontSize="9" fill="#1d4dff" opacity="0.55">
        <text x="76" y="98">empty</text>
        <text x="86" y="158">empty</text>
      </g>
    </svg>
  );
}
