import type {
  CacheEntry,
  CacheHandler,
} from "next/dist/server/lib/cache-handlers/types";
import { decode, encode } from "./codec";
import { debug } from "./debug";
import { withRedis } from "./redis";
import {
  entryKey,
  isExpired,
  isStale,
  readTagMarks,
  writeTagMarks,
} from "./tags";

// The handler behind `"use cache"`. It mirrors Next's built-in handler
// (`cache-handlers/default.ts`), with Redis instead of an in-memory LRU.

type StoredEntry = Omit<CacheEntry, "value"> & { value: Uint8Array };

// A `get` for a key that is being written waits for the write, as Next's
// handler does. Only within this process; other replicas see a miss.
const pendingSets = new Map<string, Promise<void>>();

function streamOf(bytes: Uint8Array) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

export const useCacheHandler: CacheHandler = {
  async get(cacheKey) {
    await pendingSets.get(cacheKey);
    const raw = await withRedis(
      (redis) => redis.getBuffer(entryKey("uc", cacheKey)),
      null,
    );
    if (!raw) {
      debug("use cache get", cacheKey, "miss");
      return undefined;
    }
    let entry: StoredEntry;
    try {
      entry = decode(raw) as StoredEntry;
    } catch {
      return undefined;
    }
    // Like the built-in handler, check the entry's own tags. Soft tags (the
    // route's implicit ones) go through `getExpiration`.
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
    let done!: () => void;
    pendingSets.set(cacheKey, new Promise<void>((resolve) => (done = resolve)));
    try {
      const entry = await pendingEntry;
      let value: Uint8Array;
      try {
        value = new Uint8Array(await new Response(entry.value).arrayBuffer());
      } catch {
        // The render failed halfway: an incomplete value makes an incomplete page.
        return;
      }
      const stored: StoredEntry = { ...entry, value };
      const bytes = encode(stored);
      // Next discards an entry past `expire` anyway; the TTL only cleans it up.
      const ttl =
        Number.isFinite(entry.expire) && entry.expire > 0
          ? Math.ceil(entry.expire)
          : 0;
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

  async refreshTags() {
    // Nothing to sync: tag marks are read from Redis when needed.
  },

  async getExpiration(tags) {
    const marks = await readTagMarks(tags);
    return Math.max(0, ...[...marks.values()].map((mark) => mark.expired ?? 0));
  },

  async updateTags(tags, durations) {
    debug("use cache updateTags", tags, durations);
    await writeTagMarks(tags, durations);
  },
};
