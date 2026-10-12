// @ts-check
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Redis } from "ioredis";

// The Node.js twin of `adapter/runtime/cache/redis.ts`, with ioredis instead
// of Bun.redis. Same contract: every call goes through `withRedis`, which
// returns a fallback (a cache miss) instead of failing.
//
// - While disconnected, calls return the fallback right away. ioredis keeps
//   reconnecting forever (`retryStrategy`).
// - While connected, a failed or slow command opens the circuit: for
//   `OPEN_MS` calls return the fallback without touching Redis.
const RETRY_MS = 5_000;
const OPEN_MS = 5_000;
const COMMAND_TIMEOUT_MS = 1_000;

const url = process.env.REDIS_URI;

// Keys: `next:{buildId}:inc|uc|tag:…`, as in the binary. The standalone
// server runs from its own directory, where `.next/BUILD_ID` lives.
export const keyPrefix = `next:${readBuildId()}:`;

function readBuildId() {
  try {
    return readFileSync(join(process.cwd(), ".next", "BUILD_ID"), "utf8").trim();
  } catch {
    return "unknown";
  }
}

let openUntil = 0;
let healthy = true;
let everConnected = false;

/** @param {string} reason */
function reportDown(reason) {
  if (!healthy) return;
  healthy = false;
  console.error(`⨯ Redis cache unavailable, serving without cache: ${reason}`);
}

function reportUp() {
  if (healthy) return;
  healthy = true;
  console.log("✓ Redis cache is back");
}

/** @type {Redis | undefined} */
const client = url ? connect(url) : undefined;
if (!url) {
  console.error("⨯ REDIS_URI is not set: the Redis cache handler serves without cache");
}

/** @param {string} redisUrl */
function connect(redisUrl) {
  const redis = new Redis(redisUrl, {
    connectTimeout: COMMAND_TIMEOUT_MS,
    commandTimeout: COMMAND_TIMEOUT_MS,
    // Fail fast while disconnected instead of queueing commands.
    enableOfflineQueue: false,
    maxRetriesPerRequest: 0,
    retryStrategy: () => RETRY_MS,
  });
  redis.on("ready", () => {
    everConnected = true;
    openUntil = 0;
    reportUp();
  });
  // ioredis emits connection errors here; without a listener Node logs each
  // one. The state change is reported once, below.
  redis.on("error", (error) => {
    if (!everConnected) reportDown(error.message);
  });
  redis.on("end", () => reportDown("connection closed"));
  setTimeout(() => {
    if (!everConnected) reportDown(`could not connect to ${new URL(redisUrl).host}`);
  }, RETRY_MS).unref();
  return redis;
}

/**
 * @template T
 * @param {(redis: Redis) => Promise<T>} operation
 * @param {T} fallback
 * @returns {Promise<T>}
 */
export async function withRedis(operation, fallback) {
  if (!client || Date.now() < openUntil) return fallback;
  if (client.status !== "ready") {
    if (everConnected) reportDown("connection lost, reconnecting");
    return fallback;
  }
  try {
    return await operation(client);
  } catch (error) {
    openUntil = Date.now() + OPEN_MS;
    reportDown(/** @type {Error} */ (error).message);
    return fallback;
  }
}
