import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { CompileParams } from "./compile";

const OUTPUT_FILE = "build/server";

const compileScript = join(dirname(fileURLToPath(import.meta.url)), "compile.ts");

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
    const params: CompileParams = {
      input: serverEntryPoint,
      output,
      externals,
    };
    execFileSync("bun", [compileScript, JSON.stringify(params)], {
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
