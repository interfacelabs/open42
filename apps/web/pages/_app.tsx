import type { AppProps } from 'next/app';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import { Newsreader } from 'next/font/google';

import '@/styles/globals.css';

/**
 * Pages Router app shell. Geist Sans + Mono attach as CSS variables via
 * the local `geist` package so production builds do not need Google Fonts
 * network access. Newsreader (italic, 400/500) is loaded with display:swap
 * + preload:false so it never blocks first paint — only the editorial
 * onboarding layer references it.
 */
const newsreader = Newsreader({
  subsets: ['latin'],
  weight: ['400', '500'],
  style: ['italic'],
  variable: '--font-newsreader',
  display: 'swap',
  preload: false,
});

export default function App({ Component, pageProps }: AppProps) {
  return (
    <div
      className={`${GeistSans.variable} ${GeistMono.variable} ${newsreader.variable} font-sans`}
    >
      <Component {...pageProps} />
    </div>
  );
}
