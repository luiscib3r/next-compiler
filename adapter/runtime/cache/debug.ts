// `NEXT_PRIVATE_DEBUG_CACHE=1` is Next's own switch for cache logs; the Redis
// handlers log their decisions under it too.
const enabled = Boolean(process.env.NEXT_PRIVATE_DEBUG_CACHE);

export function debug(...args: unknown[]) {
  if (enabled) console.log("RedisCache:", ...args);
}
