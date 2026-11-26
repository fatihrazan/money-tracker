import type { NextConfig } from 'next';
const config: NextConfig = {
  transpilePackages: ['@money/core', '@money/database', '@money/api-client'],
  poweredByHeader: false,
};
export default config;
