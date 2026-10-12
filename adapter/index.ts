// A Next.js Build Adapter that compiles the app into one Bun executable.
//
// Next calls `onBuildComplete` at the end of `next build`. From there
// (`generateServer` runs the first two steps, `buildServer` the third):
//
//   1. stage     (`stage.ts`, `native.ts`): copy what the production server
//      reads into `.next/next-compiler/app`: the build output, the traced
//      files from `node_modules`, the static files and the native packages.
//   2. generate  (`generate.ts`): next to it, the runtime (`runtime/`), the
//      serialized config and the list of Next's `.external` modules.
//   3. compile   (`build.ts`, `compile.ts`): `Bun.build` bundles the runtime
//      and Next, embeds the staged app and writes `build/server`.
//
// At runtime, `runtime/` makes Next work from Bun's embedded filesystem.
import type { NextAdapter } from "next";
import { relative } from "node:path";
import { buildServer } from "./build";
import { generateServer } from "./generate";
import type { TracedAsset } from "./stage";

// Packages with native addons. Bun leaves them out of the bundle, and the
// runtime extracts them to disk the first time the server requires them.
const IMAGE_OPTIMIZER = "sharp";
const NATIVE_PACKAGES = [IMAGE_OPTIMIZER];

export default {
  name: "next-compiler",
  async onBuildComplete({ projectDir, repoRoot, distDir, outputs, config }) {
    console.log("🚀 Building server for Kubernetes deployment...");
    // With `images.unoptimized`, Next never runs sharp: leave its binaries out
    // of the binary. It stays external either way, or Bun would bundle it
    // from Next's image optimizer.
    const excludedPackages = config.images?.unoptimized
      ? [IMAGE_OPTIMIZER]
      : [];
    const { serverEntryPoint } = await generateServer({
      distDir,
      projectDir,
      repoRoot,
      assets: tracedAssets(outputs, repoRoot),
      nativePackages: NATIVE_PACKAGES.filter(
        (name) => !excludedPackages.includes(name),
      ),
      excludedPackages,
      config: runtimeConfig(config),
    });
    await buildServer({
      serverEntryPoint,
      projectDir,
      externals: NATIVE_PACKAGES,
    });
  },
} as NextAdapter;

// The config the binary hands to Next (`__NEXT_PRIVATE_STANDALONE_CONFIG`),
// as `output: "standalone"` does, so the server never loads `next.config.ts`,
// which imports this adapter.
function runtimeConfig(config: unknown): string {
  // A plain copy: the resolved config may hold functions and non-JSON values.
  const value = JSON.parse(JSON.stringify(config)) as {
    adapterPath?: string;
    configFile?: string;
    outputFileTracingRoot?: string;
    repoRoot?: string;
    turbopack?: { root?: string };
    experimental?: { isrFlushToDisk?: boolean };
  };
  // Paths on the build machine. The production server never opens them, and
  // they would leak the build's directory layout into the binary.
  delete value.adapterPath;
  delete value.configFile;
  delete value.outputFileTracingRoot;
  delete value.repoRoot;
  if (value.turbopack) delete value.turbopack.root;
  // The embedded filesystem is read-only. Do not flush the incremental cache or
  // the image cache to `.next/cache`.
  value.experimental ??= {};
  value.experimental.isrFlushToDisk = false;
  return JSON.stringify(value);
}

type AdapterOutputs = Parameters<
  NonNullable<NextAdapter["onBuildComplete"]>
>[0]["outputs"];

// Every route's entry file and the files Next traced for it (`route.assets`):
// the part of `node_modules` the server actually loads.
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
