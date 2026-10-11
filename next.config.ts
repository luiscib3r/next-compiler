import type { NextConfig } from "next";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const nextConfig: NextConfig = {
  adapterPath: require.resolve("./adapter"),
  /* config options here */
  experimental: {
    agentFeedback: true,
  },
  cacheComponents: true,
  // Used by the /navigation test page.
  async redirects() {
    return [{ source: "/old-static", destination: "/static", permanent: true }];
  },
  async rewrites() {
    return [{ source: "/rewrite-config", destination: "/static" }];
  },
  async headers() {
    return [
      {
        source: "/static",
        headers: [{ key: "x-config-header", value: "next.config" }],
      },
    ];
  },
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
