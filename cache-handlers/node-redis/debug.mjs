// @ts-check
// `NEXT_PRIVATE_DEBUG_CACHE=1` is Next's own switch for cache logs.
const enabled = Boolean(process.env.NEXT_PRIVATE_DEBUG_CACHE);

/** @param {unknown[]} args */
export function debug(...args) {
  if (enabled) console.log("RedisCache:", ...args);
}
