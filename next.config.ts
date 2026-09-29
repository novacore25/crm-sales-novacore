import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  /**
   * Emits a self-contained server bundle with node_modules resolved, which is
   * what the Docker image copies into the runtime stage. Without it the
   * standalone image would need a full node_modules install at runtime.
   */
  output: 'standalone',

  // The legacy app shipped with `ignoreBuildErrors: true`, which hid real type
  // errors. It is off so `npm run build` fails on a broken type instead of
  // deploying something subtly wrong.
  typescript: {
    ignoreBuildErrors: false,
  },

  // pg is a native-ish server dependency; keep it external to the server
  // bundle so the runtime resolves it from node_modules.
  serverExternalPackages: ['pg'],

  poweredByHeader: false,
};

export default nextConfig;
