const path = require('path');
const { existsSync } = require('fs');
const { config } = require('dotenv');

for (const file of ['.env.local', '.env']) {
  const envPath = path.join(__dirname, '../..', file);
  if (existsSync(envPath)) {
    config({ path: envPath, override: false });
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  devIndicators: false,
  outputFileTracingRoot: path.join(__dirname, '../..'),
  env: {
    NEXT_PUBLIC_OPEN42_APP_URL:
      process.env.NEXT_PUBLIC_OPEN42_APP_URL ?? process.env.WEB_PUBLIC_URL ?? 'http://localhost:3000',
    NEXT_PUBLIC_OPEN42_DOCS_URL: process.env.NEXT_PUBLIC_OPEN42_DOCS_URL ?? '#architecture',
  },
};

module.exports = nextConfig;
