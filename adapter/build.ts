import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";

const OUTPUT_FILE = "build/server";

export type BuildServerParams = {
  serverEntryPoint: string;
  projectDir: string;
  /** Packages the bundle must not include. The runtime loads them. */
  externals: string[];
};

export async function buildServer({
  serverEntryPoint,
  projectDir,
  externals,
}: BuildServerParams) {
  const buildDir = join(projectDir, "build");
  // Clean build directory before building server
  rmSync(buildDir, { recursive: true, force: true });

  const output = join(projectDir, OUTPUT_FILE);

  try {
    execFileSync("bun", args({ input: serverEntryPoint, output, externals }), {
      stdio: "inherit",
    });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      console.error(
        "❌ `bun` was not found on PATH. Install it `curl -fsSL https://bun.sh/install | bash` and re-run.",
      );
      process.exit(1);
    }
    throw err;
  }
}

type ArgsParams = {
  input: string;
  output: string;
  externals: string[];
};

function args({ input, output, externals }: ArgsParams): string[] {
  const serverDir = dirname(input);
  return [
    "build",
    input,
    "--production",
    "--compile-autoload-package-json",
    "--compile",
    "--asset",
    join(serverDir, "app"),
    "--asset",
    join(serverDir, "next.config.json"),
    "--minify",
    "--external",
    "webpack",
    "--external",
    "webpack/*",
    "--external",
    "next/dist/build/webpack/*",
    "--external",
    "sass",
    "--external",
    "critters",
    ...externals.flatMap((name) => ["--external", name]),
    "--define",
    "process.env.TURBOPACK=1",
    "--define",
    "process.env.__NEXT_EXPERIMENTAL_REACT=",
    "--define",
    'process.env.NEXT_RUNTIME="nodejs"',
    "--outfile",
    output,
  ];
}
