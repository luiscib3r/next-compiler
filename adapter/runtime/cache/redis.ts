import { RedisClient } from "bun";

// Every Redis call goes through `withRedis`, which returns a fallback (a cache
// miss) instead of failing. The app keeps working without cache, as Next.js
// does when a cache write fails.
//
// - While disconnected, calls return the fallback right away. The client
//   reconnects on its own, and when it gives up (`maxRetries`), this module
//   retries every `RETRY_MS`, so a Redis restart never leaves a pod without
//   cache until it restarts too.
// - While connected, a failed or slow command opens the circuit: for
//   `OPEN_MS` calls return the fallback without touching Redis, so requests
//   never queue behind a broken connection.
const RETRY_MS = 5_000;
const OPEN_MS = 5_000;
// Bun's client has no per-command timeout. A hung connection would hang the
// request, so race every command against this.
const COMMAND_TIMEOUT_MS = 1_000;

let client: RedisClient | undefined;
let openUntil = 0;
let healthy = true;
let everConnected = false;

function reportDown(reason: string) {
  if (!healthy) return;
  healthy = false;
  console.error(`⨯ Redis cache unavailable, serving without cache: ${reason}`);
}

function reportUp() {
  if (healthy) return;
  healthy = true;
  console.log("✓ Redis cache is back");
}

export function connectRedis(url: string) {
  const redis = new RedisClient(url, {
    connectionTimeout: COMMAND_TIMEOUT_MS,
    autoReconnect: true,
    // Fail fast while disconnected instead of queueing commands.
    enableOfflineQueue: false,
  });
  redis.onconnect = () => {
    everConnected = true;
    openUntil = 0;
    reportUp();
  };
  redis.onclose = (error) => {
    reportDown(error?.message ?? "connection closed");
    setTimeout(() => connect(redis), RETRY_MS);
  };
  client = redis;
  connect(redis);
  // While the client keeps retrying, the first `connect()` neither resolves
  // nor fails; check once that the cache started.
  setTimeout(() => {
    if (!everConnected) reportDown(`could not connect to ${new URL(url).host}`);
  }, RETRY_MS).unref();
}

function connect(redis: RedisClient) {
  // A failed attempt runs `onclose`, which schedules the next one.
  redis.connect().catch((error: Error) => reportDown(error.message));
}

export async function withRedis<T>(
  operation: (redis: RedisClient) => Promise<T>,
  fallback: T,
): Promise<T> {
  if (!client || Date.now() < openUntil) return fallback;
  if (!client.connected) {
    // The client reconnects on its own without telling anyone; say it here.
    if (everConnected) reportDown("connection lost, reconnecting");
    return fallback;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(client),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Redis did not answer in ${COMMAND_TIMEOUT_MS}ms`)),
          COMMAND_TIMEOUT_MS,
        );
      }),
    ]);
  } catch (error) {
    openUntil = Date.now() + OPEN_MS;
    reportDown((error as Error).message);
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}
