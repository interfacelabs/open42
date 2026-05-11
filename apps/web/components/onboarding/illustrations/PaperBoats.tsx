interface IllustrationProps {
  className?: string;
}

/**
 * Build a tiled sine-like wave path. `tile` is the full wavelength in px,
 * `amp` the peak amplitude. The path extends from `start` to `end` so the
 * wave-drift keyframe (translates by -80px) never reveals an edge.
 */
function wavePath(
  tile: number,
  amp: number,
  start: number,
  end: number,
): string {
  const half = tile / 2;
  let d = `M ${start} 0 Q ${start + half / 2} ${-amp} ${start + half} 0`;
  for (let x = start + half * 2; x <= end; x += half) {
    d += ` T ${x} 0`;
  }
  return d;
}

// Small choppy ripples — 20px wavelength, ±2 amplitude.
const RIPPLE = wavePath(20, 2, -80, 400);
// Horizon wave — slightly more pronounced (±2.6) for the topmost water edge.
const HORIZON = wavePath(20, 2.6, -80, 400);

/**
 * "Sources sailing toward the brain" — three paper boats drifting across a
 * calm sea of small parallel ripples toward a pale-blue horizon sun.
 *
 * Animations (defined in globals.css):
 *   - ripple rows `pb-wave` drift sideways in a seamless 80px loop,
 *   - boats `pb-sail` slowly drift forward toward the sun then reset,
 *   - boats `pb-boat` bob vertically with staggered delays,
 *   - sun `pb-sun` breathes opacity.
 *
 * Respects prefers-reduced-motion (handled globally in globals.css).
 */
export function PaperBoats({ className }: IllustrationProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 320 220"
      width="100%"
      style={{ maxWidth: 340 }}
      aria-hidden="true"
    >
      <defs>
        <radialGradient id="pb-sun-halo" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#9bbcff" stopOpacity="0.35" />
          <stop offset="60%" stopColor="#9bbcff" stopOpacity="0.10" />
          <stop offset="100%" stopColor="#9bbcff" stopOpacity="0" />
        </radialGradient>
        <g id="pb-wave-row">
          <path
            d={RIPPLE}
            fill="none"
            stroke="#1d4dff"
            strokeWidth="1.1"
            strokeLinecap="round"
          />
        </g>
      </defs>

      {/* Sun halo */}
      <circle cx="240" cy="92" r="58" fill="url(#pb-sun-halo)" />

      {/* Sun disc */}
      <g className="pb-sun">
        <circle
          cx="240"
          cy="92"
          r="26"
          fill="#eaf1ff"
          stroke="#1d4dff"
          strokeWidth="1.2"
        />
      </g>

      {/* Horizon — the topmost wave separating sky from sea */}
      <g transform="translate(0 130)">
        <g className="pb-wave" style={{ animationDuration: '8s' }}>
          <path
            d={HORIZON}
            fill="none"
            stroke="#1d4dff"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
        </g>
      </g>

      {/*
       * Animated wave bands — many short parallel ripple rows. They all share
       * the same wavelength + amplitude (so they read as parallel) but drift
       * at slightly different speeds for a calm-sea parallax. Vertical pitch
       * is 8px so the rows feel like stacked sea texture, not isolated lines.
       */}
      <g>
        <g transform="translate(0 144)">
          <g className="pb-wave"><use href="#pb-wave-row" /></g>
        </g>
        <g transform="translate(10 152)" opacity="0.85">
          <g className="pb-wave" style={{ animationDuration: '10s' }}>
            <use href="#pb-wave-row" />
          </g>
        </g>
        <g transform="translate(0 160)" opacity="0.75">
          <g className="pb-wave" style={{ animationDuration: '11s' }}>
            <use href="#pb-wave-row" />
          </g>
        </g>
        <g transform="translate(10 168)" opacity="0.65">
          <g className="pb-wave" style={{ animationDuration: '12s' }}>
            <use href="#pb-wave-row" />
          </g>
        </g>
        <g transform="translate(0 176)" opacity="0.55">
          <g className="pb-wave" style={{ animationDuration: '13s' }}>
            <use href="#pb-wave-row" />
          </g>
        </g>
        <g transform="translate(10 184)" opacity="0.4">
          <g className="pb-wave" style={{ animationDuration: '14s' }}>
            <use href="#pb-wave-row" />
          </g>
        </g>
      </g>

      {/* Three paper boats — folded-paper silhouettes, sailing right toward
          the sun. Each wraps in a pb-sail group (forward drift + fade) and a
          pb-boat group (vertical bob); staggered delays spread the three
          along the same 18s loop. */}
      <g
        stroke="#1d4dff"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="#ffffff"
      >
        {/* Boat 1 — farthest left, smallest */}
        <g className="pb-sail" style={{ animationDelay: '0s' }}>
          <g transform="translate(60 120)">
            <g className="pb-boat" style={{ animationDelay: '0s' }}>
              <path d="M -14 8 L 14 8 L 10 2 L -10 2 Z" />
              <path d="M -4 2 L -4 -10 L 6 2" fill="#ffffff" />
            </g>
          </g>
        </g>

        {/* Boat 2 — middle, slightly larger */}
        <g className="pb-sail" style={{ animationDelay: '-6s' }}>
          <g transform="translate(130 124)">
            <g className="pb-boat" style={{ animationDelay: '-1.2s' }}>
              <path d="M -18 10 L 18 10 L 13 3 L -13 3 Z" />
              <path d="M -5 3 L -5 -14 L 9 3" fill="#ffffff" />
            </g>
          </g>
        </g>

        {/* Boat 3 — closest to the sun, largest */}
        <g className="pb-sail" style={{ animationDelay: '-12s' }}>
          <g transform="translate(200 122)">
            <g className="pb-boat" style={{ animationDelay: '-2.4s' }}>
              <path d="M -20 11 L 20 11 L 15 3 L -15 3 Z" />
              <path d="M -6 3 L -6 -16 L 11 3" fill="#ffffff" />
            </g>
          </g>
        </g>
      </g>

      {/* A pair of distant birds, ultra-faint, near the sun */}
      <path
        d="M 200 60 q 3 -2.5 6 0 q 3 -2.5 6 0"
        stroke="#9bbcff"
        strokeWidth="0.9"
        strokeLinecap="round"
        fill="none"
        opacity="0.55"
      />
      <path
        d="M 270 50 q 2 -1.6 4 0 q 2 -1.6 4 0"
        stroke="#9bbcff"
        strokeWidth="0.9"
        strokeLinecap="round"
        fill="none"
        opacity="0.4"
      />
    </svg>
  );
}
