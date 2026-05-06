import type { AppProps } from 'next/app';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';

import '@/styles/globals.css';

/**
 * Pages Router app shell. Geist Sans + Mono attach as CSS variables
 * (--font-geist-sans, --font-geist-mono) via the className on the wrapper.
 * Tailwind's font-sans / font-mono resolve through those variables
 * (see tailwind.config.ts).
 */
export default function App({ Component, pageProps }: AppProps) {
  return (
    <div className={`${GeistSans.variable} ${GeistMono.variable} font-sans`}>
      <Component {...pageProps} />
    </div>
  );
}
