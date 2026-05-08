import type { Config } from 'tailwindcss';

/**
 * Open42 Tailwind config.
 * Tokens mirror DESIGN.md. CSS variables defined in styles/globals.css drive
 * the theme so shadcn primitives can re-skin via the same vars.
 */
const config: Config = {
  content: [
    './pages/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  darkMode: 'class', // not used in P1 but reserved
  theme: {
    container: {
      center: true,
      padding: '1rem',
      screens: {
        '2xl': '1400px',
      },
    },
    extend: {
      colors: {
        // shadcn semantic tokens (mapped to CSS vars in globals.css)
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },

        // Open42 typography tokens (per DESIGN.md)
        text: {
          primary: 'hsl(var(--text-primary))',
          body: 'hsl(var(--text-body))',
          subtle: 'hsl(var(--text-subtle))',
          faint: 'hsl(var(--text-faint))',
        },

        // Editorial onboarding layer (per spec D6)
        'accent-deep': '#0a1f8a',
        'accent-soft': '#eef1ff',
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
        input: '10px',
        '2xl': '16px',
        '3xl': '24px',
      },
      fontFamily: {
        sans: ['var(--font-geist-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-geist-mono)', 'ui-monospace', 'monospace'],
        newsreader: ['var(--font-newsreader)', 'Georgia', 'serif'],
      },
      lineHeight: {
        display: '0.95',
        headline: '1.08',
        title: '1.18',
        body: '1.55',
      },
      letterSpacing: {
        tighter: '-0.035em',
        tight: '-0.02em',
      },
      maxWidth: {
        chat: '720px',
        landing: '720px',
      },
      transitionTimingFunction: {
        standard: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
        enter: 'cubic-bezier(0.16, 1, 0.3, 1)',
        exit: 'cubic-bezier(0.7, 0, 0.84, 0)',
      },
      transitionDuration: {
        '140': '140ms',
        '320': '320ms',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};

export default config;
