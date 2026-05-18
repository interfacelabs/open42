import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Newsreader } from "next/font/google";
import "./globals.css";

const newsreader = Newsreader({
  subsets: ["latin"],
  weight: ["400", "500"],
  style: ["italic"],
  variable: "--font-newsreader",
  display: "swap",
  preload: false,
});

export const metadata: Metadata = {
  metadataBase: new URL("https://open42.ai"),
  title: "Open42 — Turn company workflows into automations",
  description:
    "Self-hostable company brain that connects to your docs and repos, understands how work happens, and helps turn recurring workflows into reviewable AI automations.",
  openGraph: {
    type: "website",
    url: "https://open42.ai",
    siteName: "Open42",
    title: "Open42 — Turn company workflows into automations",
    description:
      "Connect company knowledge, get cited answers, and turn recurring internal workflows into reviewable AI automations.",
    images: [
      {
        url: "/hero/hero-bg.png",
        width: 1200,
        height: 630,
        alt: "Open42 company brain interface",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Open42 — Turn company workflows into automations",
    description:
      "A self-hostable company brain for cited answers and reviewable workflow automations.",
    images: ["/hero/hero-bg.png"],
  },
  icons: {
    icon: "/seo/favicon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable} ${newsreader.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-page text-ink font-sans">
        {children}
      </body>
    </html>
  );
}
