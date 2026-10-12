import { withRedis } from "./redis";

// Next.js does not delete or rewrite entries when a tag is revalidated: it
// records when the tag was invalidated, and an entry with that tag created
// earlier counts as stale or expired on read. The built-in cache keeps those
// marks in a per-process `Map` (`tagsManifest`), so a `revalidateTag()` on one
// replica never reaches the others. Here the marks live in Redis, next to the
// entries, and every replica reads the same ones.

export type TagMark = { stale?: number; expired?: number };

let prefix = "";

export function setKeyPrefix(value: string) {
  prefix = value;
}

export function entryKey(kind: "inc" | "uc", cacheKey: string) {
  return `${prefix}${kind}:${cacheKey}`;
}

function tagKey(tag: string) {
  return `${prefix}tag:${tag}`;
}

export async function readTagMarks(
  tags: string[],
): Promise<Map<string, TagMark>> {
  const marks = new Map<string, TagMark>();
  const unique = [...new Set(tags)];
  if (!unique.length) return marks;
  const values = await withRedis(
    (redis) => redis.mget(...unique.map(tagKey)),
    [] as (string | null)[],
  );
  unique.forEach((tag, i) => {
    const raw = values[i];
    if (raw) marks.set(tag, JSON.parse(raw) as TagMark);
  });
  return marks;
}

// The same rules as Next's `revalidateTag` / `updateTags`: with durations the
// tag turns stale now (and expires after `expire`), without them it expires now.
export async function writeTagMarks(
  tags: string[],
  durations?: { expire?: number },
) {
  const unique = [...new Set(tags)];
  if (!unique.length) return;
  const now = Date.now();
  const existing = await readTagMarks(unique);
  await withRedis(
    (redis) =>
      Promise.all(
        unique.map((tag) => {
          const mark: TagMark = { ...existing.get(tag) };
          if (durations) {
            mark.stale = now;
            if (durations.expire !== undefined) {
              mark.expired = now + durations.expire * 1000;
            }
          } else {
            mark.expired = now;
          }
          return redis.set(tagKey(tag), JSON.stringify(mark));
        }),
      ),
    undefined,
  );
}

// `areTagsExpired` / `areTagsStale` from Next, over the marks read from Redis.
export function isExpired(
  tags: string[],
  marks: Map<string, TagMark>,
  timestamp: number,
) {
  const now = Date.now();
  return tags.some((tag) => {
    const expired = marks.get(tag)?.expired;
    return typeof expired === "number" && expired <= now && expired > timestamp;
  });
}

export function isStale(
  tags: string[],
  marks: Map<string, TagMark>,
  timestamp: number,
) {
  return tags.some((tag) => (marks.get(tag)?.stale ?? 0) > timestamp);
}
