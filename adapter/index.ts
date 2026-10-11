import type { NextAdapter } from "next";
import { generateServer } from "./generate";
import { buildServer } from "./build";
import { relative } from "node:path";
import type { TracedAsset } from "./stage";

export default {
  name: "k8s-adapter",
  async onBuildComplete({ projectDir, repoRoot, distDir, outputs, config }) {
    console.log("🚀 Building server for Kubernetes deployment...");
    const { serverEntryPoint } = await generateServer({
      distDir,
      projectDir,
      repoRoot,
      assets: tracedAssets(outputs, repoRoot),
      config: runtimeConfig(config),
    });
    await buildServer({
      serverEntryPoint,
      projectDir,
    });
  },
} as NextAdapter;

// These fields record where the build ran. The production server does not open them.
function runtimeConfig(config: unknown): string {
  const value = JSON.parse(JSON.stringify(config)) as {
    adapterPath?: string;
    configFile?: string;
    outputFileTracingRoot?: string;
    repoRoot?: string;
    turbopack?: { root?: string };
  };
  delete value.adapterPath;
  delete value.configFile;
  delete value.outputFileTracingRoot;
  delete value.repoRoot;
  if (value.turbopack) delete value.turbopack.root;
  return JSON.stringify(value);
}

type AdapterOutputs = Parameters<
  NonNullable<NextAdapter["onBuildComplete"]>
>[0]["outputs"];

function tracedAssets(
  outputs: AdapterOutputs,
  repoRoot: string,
): TracedAsset[] {
  const routes = [
    ...outputs.pages,
    ...outputs.pagesApi,
    ...outputs.appPages,
    ...outputs.appRoutes,
    ...(outputs.middleware ? [outputs.middleware] : []),
  ];
  const assets: TracedAsset[] = [];
  for (const route of routes) {
    assets.push({
      dest: relative(repoRoot, route.filePath),
      source: route.filePath,
    });
    for (const [dest, source] of Object.entries(route.assets)) {
      assets.push({ dest, source });
    }
  }
  return assets;
}
