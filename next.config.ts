import type { NextConfig } from "next";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// `BUILD_TARGET=node` builds the classic Next.js output (`Dockerfile.node`):
// a standalone server for Node.js, without the adapter. By default the
// adapter compiles the app into a single Bun binary (`Dockerfile`).
const buildTarget = process.env.BUILD_TARGET === "node" ? "node" : "bun";

const nextConfig: NextConfig = {
  ...(buildTarget === "node"
    ? { output: "standalone" as const }
    : { adapterPath: require.resolve("./adapter") }),
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
