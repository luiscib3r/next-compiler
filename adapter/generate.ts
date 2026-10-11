import { cpSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stageApp, type TracedAsset } from "./stage";

const DIST_DIR = "k8s-server";
const SERVER_RUNTIME = "runtime";
const SERVER_ENTRY_POINT = "server.ts";

const runtimeDir = join(
  dirname(fileURLToPath(import.meta.url)),
  SERVER_RUNTIME,
);

export type GenerateServerParams = {
  distDir: string;
  projectDir: string;
  repoRoot: string;
  assets: TracedAsset[];
  /** Serialized Next config. The runtime reads it and does not load `next.config.ts`. */
  config: string;
};

export type GenerateServerResult = {
  serverEntryPoint: string;
};

export async function generateServer(
  params: GenerateServerParams,
): Promise<GenerateServerResult> {
  const serverDir = join(params.distDir, DIST_DIR);
  // Clean dist directory before generating server files
  rmSync(serverDir, { recursive: true, force: true });

  // Copy server runtime (folder) to dist directory
  cpSync(runtimeDir, serverDir, { recursive: true });

  const appDir = join(serverDir, "app");
  const { packages } = stageApp(
    params.projectDir,
    params.repoRoot,
    appDir,
    params.assets,
  );
  console.log(`staged ${packages} traced files at ${appDir}`);

  const serverEntryPoint = join(serverDir, SERVER_ENTRY_POINT);
  writeFileSync(join(serverDir, "next.config.json"), params.config);

  return { serverEntryPoint };
}
