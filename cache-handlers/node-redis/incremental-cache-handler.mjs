// @ts-check
import fileSystemCacheModule from "next/dist/server/lib/incremental-cache/file-system-cache.js";
import tagsManifestModule from "next/dist/server/lib/incremental-cache/tags-manifest.external.js";
import { decode, encode } from "./codec.mjs";
import { debug } from "./debug.mjs";
import { withRedis } from "./redis.mjs";
import { entryKey, readTagMarks, writeTagMarks } from "./tags.mjs";

// Server cache handler (`cacheHandler`) for Node.js, as
// `adapter/runtime/cache/incremental-cache-handler.ts`: pages, route handlers,
// fetch and optimized images in Redis, shared by every replica of a build.

// Both are CommonJS modules compiled from TypeScript.
/** @type {typeof import("next/dist/server/lib/incremental-cache/file-system-cache.js").default} */
const FileSystemCache =
  /** @type {any} */ (fileSystemCacheModule).default ?? fileSystemCacheModule;
const { tagsManifest } = tagsManifestModule;

const SEEDED_KINDS = new Set(["APP_PAGE", "APP_ROUTE", "PAGES"]);

export default class RedisIncrementalCacheHandler {
  /** @param {any} ctx Next's CacheHandlerContext */
  constructor(ctx) {
    // Build-time prerenders, read with Next's own filesystem cache, read-only.
    this.seeds =
      ctx.fs && ctx.serverDistDir
        ? new FileSystemCache({ ...ctx, flushToDisk: false, maxMemoryCacheSize: 0 })
        : undefined;
  }

  /** @param {string} cacheKey @param {any} ctx */
  async get(cacheKey, ctx) {
    const raw = await withRedis((redis) => redis.getBuffer(entryKey("inc", cacheKey)), null);
    /** @type {any} */
    let entry = null;
    if (raw) {
      try {
        entry = decode(raw);
      } catch {
        entry = null;
      }
    }
    if (!entry && SEEDED_KINDS.has(ctx.kind)) {
      entry = (await this.seeds?.get(cacheKey, ctx).catch(() => null)) ?? null;
    }
    if (!entry) {
      debug("get", ctx.kind, cacheKey, "miss");
      return null;
    }
    // Load this entry's tag marks from Redis into Next's `tagsManifest`, so
    // Next applies its own stale and expired rules to invalidations made on
    // any replica.
    const marks = await readTagMarks(entryTags(entry, ctx));
    for (const [tag, mark] of marks) tagsManifest.set(tag, mark);
    debug("get", ctx.kind, cacheKey, raw ? "redis" : "seed", {
      lastModified: entry.lastModified,
      marks: Object.fromEntries(marks),
    });
    return entry;
  }

  /** @param {string} cacheKey @param {any} data @param {any} ctx */
  async set(cacheKey, data, ctx) {
    const cacheControl = ctx?.cacheControl;
    const bytes = Buffer.from(encode({ lastModified: Date.now(), value: data, cacheControl }));
    const expire = cacheControl?.expire;
    const ttl = typeof expire === "number" && Number.isFinite(expire) && expire > 0 ? expire : 0;
    debug("set", data?.kind ?? null, cacheKey, { bytes: bytes.length, ttl });
    await withRedis(
      (redis) =>
        ttl
          ? redis.set(entryKey("inc", cacheKey), bytes, "EX", Math.ceil(ttl))
          : redis.set(entryKey("inc", cacheKey), bytes),
      undefined,
    );
  }

  /** @param {string | string[]} tags @param {{ expire?: number }} [durations] */
  async revalidateTag(tags, durations) {
    const list = Array.isArray(tags) ? tags : [tags];
    debug("revalidateTag", list, durations);
    await writeTagMarks(list, durations);
    for (const [tag, mark] of await readTagMarks(list)) tagsManifest.set(tag, mark);
  }

  resetRequestCache() {}
}

/** @param {any} entry @param {any} ctx @returns {string[]} */
function entryTags(entry, ctx) {
  /** @type {string[]} */
  const tags = [];
  const header = entry.value?.headers?.["x-next-cache-tags"];
  if (typeof header === "string") tags.push(...header.split(","));
  if (Array.isArray(ctx.tags)) tags.push(...ctx.tags);
  if (Array.isArray(ctx.softTags)) tags.push(...ctx.softTags);
  return tags.filter(Boolean);
}
