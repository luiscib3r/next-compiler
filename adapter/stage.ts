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

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

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
      copyProjectFile(projectDir, stageDir, source);
      packages++;
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
