import nextVitals from 'eslint-config-next/core-web-vitals';

const config = [
  {
    ignores: ['.next/**', 'next-env.d.ts'],
  },
  ...nextVitals,
];

export default config;
