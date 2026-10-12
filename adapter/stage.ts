// Step 1 of the adapter: stage the files the production server reads, with
// the same layout as the project, into the directory the binary embeds. The
// equivalent of what `output: "standalone"` copies:
//
//   - the files Next traced for each route (their `node_modules` included)
//   - `.next/server`, `.next/static`, `public/` and `package.json`
//   - the files in `required-server-files.json` (manifests, `BUILD_ID`, …)
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";

type RequiredServerFiles = {
  files?: string[];
};

type NftTrace = {
  files?: string[];
};

export type TracedAsset = {
  /** Path relative to `repoRoot`, as Next reports it in `outputs`. */
  dest: string;
  source: string;
};

// `stageDir` sits next to the runtime entry. Call this from generate, before compile.
export function stageApp(
  projectDir: string,
  repoRoot: string,
  stageDir: string,
  assets: TracedAsset[],
): { files: number } {
  mkdirSync(stageDir, { recursive: true });

  let files = 0;
  // Paths relative to `repoRoot`, already staged.
  const seen = new Set<string>();
  for (const asset of assets) {
    if (seen.has(asset.dest)) continue;
    seen.add(asset.dest);
    const destRel = relative(projectDir, join(repoRoot, asset.dest));
    // The adapter's own files, if a trace picks them up: they only run during
    // the build, and the binary bundles its runtime from the copy `generate`
    // makes.
    if (destRel === "adapter" || destRel.startsWith("adapter/")) continue;
    if (!isFile(asset.source)) continue;
    if (copyProjectFile(projectDir, stageDir, asset.source, destRel)) files++;
  }

  // `outputs` omits routes that Next prerendered to static files, such as
  // `app/favicon.ico/route.js`. The server still loads their modules, so also
  // stage every trace under `.next/server`.
  const serverDir = join(projectDir, ".next", "server");
  for (const entry of readdirSync(serverDir, {
    recursive: true,
    encoding: "utf8",
  })) {
    const nft = join(serverDir, entry);
    if (!nft.endsWith(".nft.json")) continue;
    const trace = JSON.parse(readFileSync(nft, "utf8")) as NftTrace;
    for (const file of trace.files ?? []) {
      const source = join(dirname(nft), file);
      const dest = relative(repoRoot, source);
      if (seen.has(dest) || !isFile(source)) continue;
      seen.add(dest);
      if (copyProjectFile(projectDir, stageDir, source)) files++;
    }
  }

  const required = JSON.parse(
    readFileSync(
      join(projectDir, ".next", "required-server-files.json"),
      "utf8",
    ),
  ) as RequiredServerFiles;
  for (const file of required.files ?? []) {
    copyProjectFile(projectDir, stageDir, join(projectDir, file));
  }

  cpSync(
    join(projectDir, ".next", "server"),
    join(stageDir, ".next", "server"),
    {
      recursive: true,
      filter: (source) => !isBuildOnly(source),
    },
  );
  cpSync(
    join(projectDir, ".next", "static"),
    join(stageDir, ".next", "static"),
    {
      recursive: true,
    },
  );
  cpSync(join(projectDir, "public"), join(stageDir, "public"), {
    recursive: true,
  });
  copyProjectFile(projectDir, stageDir, join(projectDir, "package.json"));

  return { files };
}

// Copies `source` to the same path under `stageDir` as it has under
// `projectDir`. Files outside the project (in a monorepo, the repo root's
// `node_modules`) and build-only files are skipped; returns whether it copied.
function copyProjectFile(
  projectDir: string,
  stageDir: string,
  source: string,
  destRel = relative(projectDir, source),
): boolean {
  if (destRel.startsWith("..") || isBuildOnly(source)) return false;
  const dest = join(stageDir, destRel);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(source, dest);
  return true;
}

// Files the production server never reads: source maps (stack traces show
// the minified positions) and the dependency traces used to stage the app.
function isBuildOnly(path: string): boolean {
  return path.endsWith(".map") || path.endsWith(".nft.json");
}

// Traces list directories and missing files too.
function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}
