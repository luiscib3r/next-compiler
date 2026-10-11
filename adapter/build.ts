import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";

const OUTPUT_FILE = "build/server";

export type BuildServerParams = {
  serverEntryPoint: string;
  projectDir: string;
};

export async function buildServer({
  serverEntryPoint,
  projectDir,
}: BuildServerParams) {
  const buildDir = join(projectDir, "build");
  // Clean build directory before building server
  rmSync(buildDir, { recursive: true, force: true });

  const output = join(projectDir, OUTPUT_FILE);

  try {
    execFileSync("bun", args({ input: serverEntryPoint, output }), {
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
};

function args({ input, output }: ArgsParams): string[] {
  return [
    "build",
    input,
    "--production",
    "--compile-autoload-package-json",
    "--compile",
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
