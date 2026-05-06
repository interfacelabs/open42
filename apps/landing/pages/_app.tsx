import type { AppProps } from 'next/app';
import { Geist, Geist_Mono } from 'next/font/google';

import '@/styles/globals.css';

const geistSans = Geist({
  subsets: ['latin'],
  variable: '--font-geist-sans',
  weight: ['400', '500', '600'],
});

const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
  weight: ['400', '500'],
});

export default function App({ Component, pageProps }: AppProps) {
  return (
    <div className={`${geistSans.variable} ${geistMono.variable}`}>
      <Component {...pageProps} />
    </div>
  );
}
