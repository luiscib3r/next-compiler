import type {
  CacheHandler,
  CacheHandlerContext,
  CacheHandlerValue,
} from "next/dist/server/lib/incremental-cache";
import FileSystemCache from "next/dist/server/lib/incremental-cache/file-system-cache";
import { tagsManifest } from "next/dist/server/lib/incremental-cache/tags-manifest.external";
import type { IncrementalCacheValue } from "next/dist/server/response-cache";
import { decode, encode } from "./codec";
import { debug } from "./debug";
import { withRedis } from "./redis";
import { entryKey, readTagMarks, writeTagMarks } from "./tags";

// The handler behind Next's server cache (`cacheHandler`): prerendered and ISR
// pages, route handler responses, `fetch` and optimized images. It does what
// the built-in filesystem cache does with `.next/cache`, in Redis, so every
// replica of the same build shares it.

type GetContext = Parameters<CacheHandler["get"]>[1];
type SetContext = Parameters<CacheHandler["set"]>[2];

type StoredEntry = {
  lastModified: number;
  value: IncrementalCacheValue | null;
  cacheControl?: CacheHandlerValue["cacheControl"];
};

// Kinds whose build-time prerender may sit in `.next/server/route-cache`.
const SEEDED_KINDS = new Set(["APP_PAGE", "APP_ROUTE", "PAGES"]);

export class RedisIncrementalCacheHandler implements CacheHandler {
  // Prerenders from the build live in the binary. Next's own filesystem cache
  // reads them, without writing anything back, so its format (HTML, RSC,
  // segments and the postponed PPR state) is not reimplemented here.
  private seeds?: FileSystemCache;

  constructor(ctx: CacheHandlerContext) {
    // Next passes both to the server cache handler.
    if (ctx.fs && ctx.serverDistDir) {
      this.seeds = new FileSystemCache({
        ...ctx,
        fs: ctx.fs,
        serverDistDir: ctx.serverDistDir,
        flushToDisk: false,
        maxMemoryCacheSize: 0,
      });
    }
  }

  async get(
    cacheKey: string,
    ctx: GetContext,
  ): Promise<CacheHandlerValue | null> {
    const raw = await withRedis(
      (redis) => redis.getBuffer(entryKey("inc", cacheKey)),
      null,
    );
    let entry: CacheHandlerValue | null = null;
    if (raw) {
      try {
        entry = decode(raw) as StoredEntry;
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

    // Next decides whether the entry is stale or expired with `tagsManifest`,
    // the per-process map of tag invalidations. Load the marks for this
    // entry's tags from Redis into it, so Next applies its own rules to
    // invalidations made on any replica.
    const marks = await readTagMarks(entryTags(entry, ctx));
    for (const [tag, mark] of marks) tagsManifest.set(tag, mark);
    debug("get", ctx.kind, cacheKey, raw ? "redis" : "seed", {
      lastModified: entry.lastModified,
      marks: Object.fromEntries(marks),
    });
    return entry;
  }

  async set(
    cacheKey: string,
    data: IncrementalCacheValue | null,
    ctx: SetContext,
  ) {
    const cacheControl = "cacheControl" in ctx ? ctx.cacheControl : undefined;
    const stored: StoredEntry = {
      lastModified: Date.now(),
      value: data,
      cacheControl,
    };
    // Next discards an entry past `expire` anyway; the TTL only cleans it up.
    const expire = cacheControl?.expire;
    const ttl =
      typeof expire === "number" && Number.isFinite(expire) && expire > 0
        ? expire
        : 0;
    const bytes = encode(stored);
    debug("set", data?.kind ?? null, cacheKey, { bytes: bytes.length, ttl });
    await withRedis(
      (redis) =>
        ttl
          ? redis.set(entryKey("inc", cacheKey), bytes, "EX", Math.ceil(ttl))
          : redis.set(entryKey("inc", cacheKey), bytes),
      undefined,
    );
  }

  async revalidateTag(
    tags: string | string[],
    durations?: { expire?: number },
  ) {
    const list = Array.isArray(tags) ? tags : [tags];
    debug("revalidateTag", list, durations);
    await writeTagMarks(list, durations);
    // This process reads the marks again on its next `get`; update it now too.
    for (const [tag, mark] of await readTagMarks(list))
      tagsManifest.set(tag, mark);
  }

  resetRequestCache() {}
}

// The tags Next checks for this entry: the ones stored with a page or route
// response (`x-next-cache-tags`, which includes the route's soft tags), and
// the ones a `fetch` read passes in.
function entryTags(entry: CacheHandlerValue, ctx: GetContext): string[] {
  const tags: string[] = [];
  const value = entry.value as { headers?: Record<string, unknown> } | null;
  const header = value?.headers?.["x-next-cache-tags"];
  if (typeof header === "string") tags.push(...header.split(","));
  if ("tags" in ctx && Array.isArray(ctx.tags)) tags.push(...ctx.tags);
  if ("softTags" in ctx && Array.isArray(ctx.softTags))
    tags.push(...ctx.softTags);
  return tags.filter(Boolean);
}
