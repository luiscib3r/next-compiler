// @ts-check
import { decode, encode } from "./codec.mjs";
import { debug } from "./debug.mjs";
import { withRedis } from "./redis.mjs";
import { entryKey, isExpired, isStale, readTagMarks, writeTagMarks } from "./tags.mjs";

// `"use cache"` handler for Node.js, as `adapter/runtime/cache/use-cache-handler.ts`.
// Next loads it from `cacheHandlers` in next.config.

/** @typedef {import("next/dist/server/lib/cache-handlers/types.js").CacheHandler} CacheHandler */

/** @type {Map<string, Promise<void>>} */
const pendingSets = new Map();

/** @param {Uint8Array} bytes */
function streamOf(bytes) {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

/** @type {CacheHandler} */
const useCacheHandler = {
  async get(cacheKey) {
    await pendingSets.get(cacheKey);
    const raw = await withRedis((redis) => redis.getBuffer(entryKey("uc", cacheKey)), null);
    if (!raw) {
      debug("use cache get", cacheKey, "miss");
      return undefined;
    }
    /** @type {any} */
    let entry;
    try {
      entry = decode(raw);
    } catch {
      return undefined;
    }
    let { revalidate } = entry;
    if (entry.tags.length) {
      const marks = await readTagMarks(entry.tags);
      if (isExpired(entry.tags, marks, entry.timestamp)) {
        debug("use cache get", cacheKey, "expired tag", entry.tags);
        return undefined;
      }
      if (isStale(entry.tags, marks, entry.timestamp)) revalidate = -1;
    }
    debug("use cache get", cacheKey, { tags: entry.tags, revalidate });
    return { ...entry, revalidate, value: streamOf(entry.value) };
  },

  async set(cacheKey, pendingEntry) {
    /** @type {() => void} */
    let done = () => {};
    pendingSets.set(cacheKey, new Promise((resolve) => (done = resolve)));
    try {
      const entry = await pendingEntry;
      let value;
      try {
        value = new Uint8Array(await new Response(entry.value).arrayBuffer());
      } catch {
        return;
      }
      const bytes = Buffer.from(encode({ ...entry, value }));
      const ttl = Number.isFinite(entry.expire) && entry.expire > 0 ? Math.ceil(entry.expire) : 0;
      await withRedis(
        (redis) =>
          ttl
            ? redis.set(entryKey("uc", cacheKey), bytes, "EX", ttl)
            : redis.set(entryKey("uc", cacheKey), bytes),
        undefined,
      );
    } finally {
      pendingSets.delete(cacheKey);
      done();
    }
  },

  async refreshTags() {},

  async getExpiration(tags) {
    const marks = await readTagMarks(tags);
    return Math.max(0, ...[...marks.values()].map((mark) => mark.expired ?? 0));
  },

  async updateTags(tags, durations) {
    debug("use cache updateTags", tags, durations);
    await writeTagMarks(tags, durations);
  },
};

export default useCacheHandler;
