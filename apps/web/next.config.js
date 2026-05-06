const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  outputFileTracingRoot: path.join(__dirname, '../..'),
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
