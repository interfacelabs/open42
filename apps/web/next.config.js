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
  // Trace from the monorepo root so workspace packages resolve in production bundles.
  outputFileTracingRoot: path.join(__dirname, '../..'),
  transpilePackages: ['geist'],
  webpack(config) {
    const edition = process.env.OPEN42_EDITION ?? 'community';
    const target = edition === 'cloud' ? 'packages/cloud' : 'packages/cloud-stubs';
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      '@open42/cloud': path.resolve(__dirname, '../..', target),
    };
    return config;
  },
  // Pages Router (default in Next 15 if no app/ dir present).
  // Proxy /api requests to the Express backend in dev.
  async rewrites() {
    if (process.env.NODE_ENV !== 'production') {
      return [
        {
          source: '/backend/:path*',
          destination: `${process.env.API_PUBLIC_URL ?? 'http://localhost:3001'}/:path*`,
        },
      ];
    }
    return [];
  },
};

module.exports = nextConfig;
