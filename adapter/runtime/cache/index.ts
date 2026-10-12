import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RedisIncrementalCacheHandler } from "./incremental-cache-handler";
import { connectRedis } from "./redis";
import { setKeyPrefix } from "./tags";
import { useCacheHandler } from "./use-cache-handler";

// The shim that `next.config.cacheHandler` points to. Next loads the handler
// with `import()` of a path; the shim re-exports the class compiled into the
// binary. Written by `adapter/generate.ts`, keep the two in sync.
export const INCREMENTAL_HANDLER_SYMBOL = Symbol.for(
  "next-compiler.incremental-cache-handler",
);
const SHIM = join(".next-compiler", "cache-handler.mjs");

type RuntimeConfig = {
  cacheHandler?: string;
  cacheMaxMemorySize?: number;
  images?: { customCacheHandler?: boolean };
};

// Turns the Redis cache on: registers the handlers and points the config at
// them. Called before the config reaches Next.
export function enableRedisCache(
  config: RuntimeConfig,
  appDir: string,
  url: string,
) {
  // Entries of one build never mix with another's: during a rolling update a
  // new pod must not serve pages rendered with the previous build's chunks.
  const buildId = readFileSync(
    join(appDir, ".next", "BUILD_ID"),
    "utf8",
  ).trim();
  setKeyPrefix(`next:${buildId}:`);
  connectRedis(url);

  // `"use cache"`: Next reads its handlers from this global.
  const handlers = Symbol.for("@next/cache-handlers");
  const scope = globalThis as Record<symbol, unknown>;
  scope[handlers] = {
    ...(scope[handlers] as object | undefined),
    DefaultCache: useCacheHandler,
    RemoteCache: useCacheHandler,
  };

  // The server cache (pages, routes, fetch, images).
  scope[INCREMENTAL_HANDLER_SYMBOL] = RedisIncrementalCacheHandler;
  config.cacheHandler = join(appDir, SHIM);
  // No per-pod copy in memory: every read goes to the shared cache.
  config.cacheMaxMemorySize = 0;
  // Optimized images go through `cacheHandler` too (opt-in since Next 16.2).
  config.images = { ...config.images, customCacheHandler: true };
}
