import { cn } from '@/lib/utils';

interface HorizonGlyphProps {
  /** Pixel size of the square viewport. Defaults to 160. */
  size?: number;
  /** Subtle float animation. Defaults to true. */
  animated?: boolean;
  className?: string;
}

/**
 * Editorial empty-state glyph: a pale blue sun above a thin horizon line,
 * with a soft reflection. Minimal vector, no fills beyond palette tokens,
 * no decorative noise. Intended for "calm" empty states across the app.
 */
export function HorizonGlyph({
  size = 160,
  animated = true,
  className,
}: HorizonGlyphProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 160 160"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="A pale sun rising over a calm horizon"
      className={cn(animated && 'horizon-float', className)}
    >
      <defs>
        {/* Soft halo around the sun */}
        <radialGradient id="hg-halo" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#9bbcff" stopOpacity="0.32" />
          <stop offset="55%" stopColor="#9bbcff" stopOpacity="0.10" />
          <stop offset="100%" stopColor="#9bbcff" stopOpacity="0" />
        </radialGradient>
        {/* Fade the reflection ripples toward the edges */}
        <linearGradient id="hg-ripple" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor="#9bbcff" stopOpacity="0" />
          <stop offset="50%" stopColor="#9bbcff" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#9bbcff" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Halo */}
      <circle cx="80" cy="76" r="44" fill="url(#hg-halo)" />

      {/* Sun — pale blue disc */}
      <circle
        cx="80"
        cy="76"
        r="22"
        fill="#eaf1ff"
        stroke="#9bbcff"
        strokeWidth="1"
      />

      {/* Horizon line */}
      <line
        x1="14"
        y1="100"
        x2="146"
        y2="100"
        stroke="#9bbcff"
        strokeWidth="1"
        strokeLinecap="round"
      />

      {/* Reflection ripples */}
      <line
        x1="46"
        y1="112"
        x2="114"
        y2="112"
        stroke="url(#hg-ripple)"
        strokeWidth="1"
        strokeLinecap="round"
      />
      <line
        x1="34"
        y1="122"
        x2="126"
        y2="122"
        stroke="url(#hg-ripple)"
        strokeWidth="1"
        strokeLinecap="round"
        opacity="0.65"
      />
      <line
        x1="54"
        y1="132"
        x2="106"
        y2="132"
        stroke="url(#hg-ripple)"
        strokeWidth="1"
        strokeLinecap="round"
        opacity="0.35"
      />

      {/* A pair of distant birds, ultra-faint */}
      <path
        d="M 110 56 q 3 -2.5 6 0 q 3 -2.5 6 0"
        stroke="#9bbcff"
        strokeWidth="0.9"
        strokeLinecap="round"
        fill="none"
        opacity="0.55"
      />
      <path
        d="M 36 64 q 2 -1.6 4 0 q 2 -1.6 4 0"
        stroke="#9bbcff"
        strokeWidth="0.9"
        strokeLinecap="round"
        fill="none"
        opacity="0.40"
      />
    </svg>
  );
}
