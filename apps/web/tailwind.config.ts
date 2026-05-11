import type { Config } from 'tailwindcss';

/**
 * Open42 Tailwind config.
 *
 * Tokens live in styles/globals.css. shadcn semantic colors are exposed as
 * HSL channels; Open42 product palette is exposed as direct CSS variables.
 */
const config: Config = {
  content: [
    './pages/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  darkMode: 'class',
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
        // shadcn semantic tokens
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

        // Open42 typography tokens
        text: {
          primary: 'hsl(var(--text-primary))',
          body: 'hsl(var(--text-body))',
          subtle: 'hsl(var(--text-subtle))',
          faint: 'hsl(var(--text-faint))',
        },

        // Open42 product palette (direct hex)
        panel: 'var(--panel)',
        'panel-soft': 'var(--panel-soft)',
        'panel-blue': 'var(--panel-blue)',
        'border-soft': 'var(--border-soft)',
        blue: 'var(--blue)',
        'blue-soft': 'var(--blue-soft)',
        'blue-line': 'var(--blue-line)',
        green: 'var(--green)',
        'black-button': 'var(--black-button)',
        'black-button-hover': 'var(--black-button-hover)',
        orange: 'var(--orange)',
        'orange-soft': 'var(--orange-soft)',

        // Editorial onboarding layer (legacy, kept for compatibility)
        'accent-deep': '#0a1f8a',
        'accent-soft': '#eaf1ff',
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
        input: '10px',
        '2xl': '16px',
        '3xl': '20px',
      },
      fontFamily: {
        sans: ['var(--font-geist-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-geist-mono)', 'ui-monospace', 'monospace'],
        newsreader: ['var(--font-newsreader)', 'Georgia', 'serif'],
        serif: ['var(--font-newsreader)', 'Georgia', 'serif'],
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
      boxShadow: {
        card: '0 1px 2px rgba(16, 17, 20, 0.04)',
        elevate: '0 1px 2px rgba(16, 17, 20, 0.04), 0 4px 12px rgba(16, 17, 20, 0.04)',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};

export default config;
