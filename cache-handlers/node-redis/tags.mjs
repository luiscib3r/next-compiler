// @ts-check
import { keyPrefix, withRedis } from "./redis.mjs";

// Tag invalidation marks in Redis, as in `adapter/runtime/cache/tags.ts`:
// Next keeps them in a per-process map, so they move to Redis next to the
// entries and every replica reads the same ones.

/** @typedef {{ stale?: number, expired?: number }} TagMark */

/** @param {"inc" | "uc"} kind @param {string} cacheKey */
export function entryKey(kind, cacheKey) {
  return `${keyPrefix}${kind}:${cacheKey}`;
}

/** @param {string} tag */
function tagKey(tag) {
  return `${keyPrefix}tag:${tag}`;
}

/** @param {string[]} tags @returns {Promise<Map<string, TagMark>>} */
export async function readTagMarks(tags) {
  /** @type {Map<string, TagMark>} */
  const marks = new Map();
  const unique = [...new Set(tags)];
  if (!unique.length) return marks;
  const values = await withRedis(
    (redis) => redis.mget(...unique.map(tagKey)),
    /** @type {(string | null)[]} */ ([]),
  );
  unique.forEach((tag, i) => {
    const raw = values[i];
    if (raw) marks.set(tag, JSON.parse(raw));
  });
  return marks;
}

/** @param {string[]} tags @param {{ expire?: number }} [durations] */
export async function writeTagMarks(tags, durations) {
  const unique = [...new Set(tags)];
  if (!unique.length) return;
  const now = Date.now();
  const existing = await readTagMarks(unique);
  await withRedis(
    (redis) =>
      Promise.all(
        unique.map((tag) => {
          /** @type {TagMark} */
          const mark = { ...existing.get(tag) };
          if (durations) {
            mark.stale = now;
            if (durations.expire !== undefined) mark.expired = now + durations.expire * 1000;
          } else {
            mark.expired = now;
          }
          return redis.set(tagKey(tag), JSON.stringify(mark));
        }),
      ),
    undefined,
  );
}

/** @param {string[]} tags @param {Map<string, TagMark>} marks @param {number} timestamp */
export function isExpired(tags, marks, timestamp) {
  const now = Date.now();
  return tags.some((tag) => {
    const expired = marks.get(tag)?.expired;
    return typeof expired === "number" && expired <= now && expired > timestamp;
  });
}

/** @param {string[]} tags @param {Map<string, TagMark>} marks @param {number} timestamp */
export function isStale(tags, marks, timestamp) {
  return tags.some((tag) => (marks.get(tag)?.stale ?? 0) > timestamp);
}
