import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "next/dist/server/lib/start-server";

const runtimeDir = dirname(fileURLToPath(import.meta.url));
const appDir = join(runtimeDir, "app");
const port = Number(process.env.PORT ?? 8080);

// Written at generate time. Skips loading `next.config.ts`, which imports the adapter.
process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = readFileSync(
  join(runtimeDir, "next.config.json"),
  "utf8",
);

await startServer({
  dir: appDir,
  isDev: false,
  hostname: "127.0.0.1",
  port,
});
