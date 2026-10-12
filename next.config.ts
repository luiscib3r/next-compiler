import type { NextConfig } from "next";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// `BUILD_TARGET=node` builds the classic Next.js output (`Dockerfile.node`):
// a standalone server for Node.js, without the adapter. By default the
// adapter compiles the app into a single Bun binary (`Dockerfile`).
const buildTarget = process.env.BUILD_TARGET === "node" ? "node" : "bun";

// `BUILD_CACHE=redis` (Node only) adds the Redis cache handlers, the Node.js
// twin of the one the adapter compiles into the binary. They read
// `REDIS_URI` at runtime. The Bun build never references them: the binary
// brings its own.
const nodeRedisCache: NextConfig =
  buildTarget === "node" && process.env.BUILD_CACHE === "redis"
    ? {
        cacheHandler: require.resolve(
          "./cache-handlers/node-redis/incremental-cache-handler.mjs",
        ),
        cacheHandlers: {
          default: require.resolve("./cache-handlers/node-redis/use-cache-handler.mjs"),
          remote: require.resolve("./cache-handlers/node-redis/use-cache-handler.mjs"),
        },
        // No per-process copy in memory: every read goes to the shared cache.
        cacheMaxMemorySize: 0,
        images: { customCacheHandler: true },
      }
    : {};

const nextConfig: NextConfig = {
  ...(buildTarget === "node"
    ? { output: "standalone" as const }
    : { adapterPath: require.resolve("./adapter") }),
  ...nodeRedisCache,
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
