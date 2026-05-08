interface IllustrationProps {
  className?: string;
}

export function PagesIntoBox({ className }: IllustrationProps) {
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
        <rect x="200" y="100" width="80" height="80" rx="6" />
        <line x1="220" y1="120" x2="260" y2="120" />
        <line x1="220" y1="140" x2="260" y2="140" />
        <line x1="220" y1="160" x2="250" y2="160" />
        <rect
          x="40"
          y="80"
          width="40"
          height="50"
          rx="2"
          fill="#fff"
          transform="rotate(-10 60 105)"
        />
        <rect
          x="78"
          y="55"
          width="40"
          height="50"
          rx="2"
          fill="#fff"
          transform="rotate(-4 98 80)"
        />
        <rect
          x="124"
          y="38"
          width="40"
          height="50"
          rx="2"
          fill="#fff"
          transform="rotate(2 144 63)"
        />
        <rect
          x="170"
          y="55"
          width="40"
          height="50"
          rx="2"
          fill="#fff"
          transform="rotate(8 190 80)"
        />
        <path d="M 60 110 Q 110 60 200 130" strokeDasharray="2 4" opacity="0.45" />
      </g>
    </svg>
  );
}
