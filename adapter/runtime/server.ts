import "./require";
import "./fs";

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { startServer } from "next/dist/server/lib/start-server";

// In the compiled binary this is `/$bunfs/root`, where `--asset` mounts `app/`
// and `next.config.json`. Running the entry with Bun, it is the real directory.
const runtimeDir = import.meta.dir;
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
  // Listen on every interface: in a container, traffic arrives on the pod's
  // network interface, not on loopback. Not `HOSTNAME`: Kubernetes sets it
  // to the pod name.
  hostname: process.env.HOST ?? "0.0.0.0",
  port,
});
