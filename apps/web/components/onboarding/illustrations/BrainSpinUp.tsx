interface IllustrationProps {
  className?: string;
  failed?: boolean;
}

/**
 * Concentric breathing rings around a central node — visual for the
 * "spinning up your brain runtime" provisioning step. CSS-driven so
 * it keeps animating even when the React tree is suspended.
 */
export function BrainSpinUp({ className, failed = false }: IllustrationProps) {
  const stroke = failed ? '#b91c1c' : '#1d4dff';
  return (
    <svg
      className={className}
      viewBox="0 0 320 220"
      width="100%"
      style={{ maxWidth: 340 }}
      aria-hidden="true"
    >
      <g
        stroke={stroke}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {/* outer ring */}
        <circle
          cx="160"
          cy="110"
          r="92"
          strokeWidth="1"
          opacity="0.18"
          style={
            failed
              ? undefined
              : { animation: 'brain-pulse 3.2s ease-in-out infinite' }
          }
        />
        {/* mid ring */}
        <circle
          cx="160"
          cy="110"
          r="68"
          strokeWidth="1.1"
          opacity="0.32"
          style={
            failed
              ? undefined
              : {
                  animation:
                    'brain-pulse 3.2s ease-in-out infinite',
                  animationDelay: '0.4s',
                }
          }
        />
        {/* inner ring */}
        <circle
          cx="160"
          cy="110"
          r="44"
          strokeWidth="1.3"
          opacity="0.55"
          style={
            failed
              ? undefined
              : {
                  animation: 'brain-pulse 3.2s ease-in-out infinite',
                  animationDelay: '0.8s',
                }
          }
        />
        {/* sweeping arc */}
        {!failed ? (
          <path
            d="M 160 38 A 72 72 0 0 1 232 110"
            strokeWidth="1.6"
            opacity="0.85"
            style={{
              transformOrigin: '160px 110px',
              animation: 'brain-rotate 2.4s linear infinite',
            }}
          />
        ) : null}
        {/* center node */}
        <circle
          cx="160"
          cy="110"
          r="6"
          fill={stroke}
          stroke="none"
          opacity={failed ? 0.85 : 1}
          style={
            failed
              ? undefined
              : { animation: 'brain-glow 1.6s ease-in-out infinite' }
          }
        />
      </g>
    </svg>
  );
}
