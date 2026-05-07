import type { AppProps } from 'next/app';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';

import '@/styles/globals.css';

/**
 * Pages Router app shell. Geist Sans + Mono attach as CSS variables via
 * the local `geist` package so production builds do not need Google Fonts
 * network access.
 */
export default function App({ Component, pageProps }: AppProps) {
  return (
    <div className={`${GeistSans.variable} ${GeistMono.variable} font-sans`}>
      <Component {...pageProps} />
    </div>
  );
}
