import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

/** Written into the staged app. The runtime reads it from `/$bunfs`. */
export const NATIVE_MANIFEST = ".native.json";

export type NativeManifest = {
  /** Changes on every build, so a stale extraction is never reused. */
  id: string;
  /** Packages the server requires by name, such as `sharp`. */
  roots: string[];
  /** The roots and their dependencies, extracted together at runtime. */
  packages: string[];
};

type PackageJson = {
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  os?: string[];
  cpu?: string[];
  libc?: string[];
};

// Native addons cannot load from `/$bunfs`: `dlopen` needs a real file, and
// the addon finds its shared libraries relative to itself (`$ORIGIN`). Stage
// each root with its whole dependency tree, so the runtime can extract them
// to disk with the `node_modules` layout they expect.
export function stageNativePackages(
  projectDir: string,
  stageDir: string,
  roots: string[],
): NativeManifest {
  const packages = new Set<string>();
  const visit = (name: string, optional: boolean) => {
    if (packages.has(name)) return;
    const dir = join(projectDir, "node_modules", name);
    const pkgPath = join(dir, "package.json");
    if (!existsSync(pkgPath)) {
      if (!optional) console.warn(`native package ${name} is not installed`);
      return;
    }
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as PackageJson;
    // Optional dependencies hold the prebuilt binaries for each platform.
    // Keep only the ones this platform can load.
    if (optional && !matchesPlatform(pkg)) return;
    packages.add(name);
    for (const dep of Object.keys(pkg.dependencies ?? {})) visit(dep, false);
    for (const dep of Object.keys(pkg.optionalDependencies ?? {})) {
      visit(dep, true);
    }
  };
  for (const root of roots) visit(root, true);

  for (const name of packages) {
    const dest = join(stageDir, "node_modules", name);
    // Replace the partial copy that the traced assets may have left.
    rmSync(dest, { recursive: true, force: true });
    cpSync(join(projectDir, "node_modules", name), dest, {
      recursive: true,
      dereference: true,
    });
  }

  const manifest: NativeManifest = {
    id: randomUUID(),
    roots: roots.filter((root) => packages.has(root)),
    packages: [...packages],
  };
  writeFileSync(join(stageDir, NATIVE_MANIFEST), JSON.stringify(manifest));
  return manifest;
}

function matchesPlatform(pkg: PackageJson): boolean {
  if (pkg.os && !pkg.os.includes(process.platform)) return false;
  if (pkg.cpu && !pkg.cpu.includes(process.arch)) return false;
  if (pkg.libc && !pkg.libc.includes(libc())) return false;
  return true;
}

function libc(): string {
  const report = process.report?.getReport() as
    | { header?: { glibcVersionRuntime?: string } }
    | undefined;
  return report?.header?.glibcVersionRuntime ? "glibc" : "musl";
}
