class Handler {}

const symbol = Symbol.for("next-compiler.incremental-cache-handler");
globalThis[symbol] = Handler;

const path = "/$bunfs/root/app/cache-handler.mjs";
const loaded = await import(path);
console.log(loaded.default === Handler ? "same class" : "different class");
