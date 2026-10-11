import {
  copyFileSync,
  cpSync,
  mkdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";

type RequiredServerFiles = {
  files?: string[];
};

function copyProjectFile(projectDir: string, stageDir: string, source: string) {
  const destRel = relative(projectDir, source);
  if (destRel.startsWith("..")) return;
  const dest = join(stageDir, destRel);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(source, dest);
}

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
): { packages: number } {
  mkdirSync(stageDir, { recursive: true });

  let packages = 0;
  const seen = new Set<string>();
  for (const asset of assets) {
    if (seen.has(asset.dest)) continue;
    seen.add(asset.dest);
    const source = asset.source;
    try {
      if (!statSync(source).isFile()) continue;
    } catch {
      continue;
    }
    const destRel = relative(projectDir, join(repoRoot, asset.dest));
    if (
      destRel.startsWith("..") ||
      destRel === "adapter" ||
      destRel.startsWith("adapter/")
    ) {
      continue;
    }
    const dest = join(stageDir, destRel);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(source, dest);
    packages++;
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

  return { packages };
}
