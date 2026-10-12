import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Written by `adapter/native.ts` at generate time.
type NativeManifest = {
  id: string;
  roots: string[];
  packages: string[];
};

const appDir = join(import.meta.dir, "app");

const manifest = readManifest();
// Packages whose load failure was already logged.
const reported = new Set<string>();
// The directory the packages were extracted to, once they are.
let extracted: string | undefined;

function readManifest(): NativeManifest {
  try {
    return JSON.parse(readFileSync(join(appDir, ".native.json"), "utf8"));
  } catch {
    return { id: "", roots: [], packages: [] };
  }
}

/** Whether `id` names a native package or a path inside one. */
export function isNative(id: string): boolean {
  return manifest.roots.some(
    (root) => id === root || id.startsWith(`${root}/`),
  );
}

// A native addon cannot load from `/$bunfs`: `dlopen` needs a real file, and
// the addon finds its shared libraries relative to itself (`$ORIGIN`). Copy
// the native packages to disk with their `node_modules` layout, then load
// them from there with Bun's own resolver.
export function requireNative(id: string): unknown {
  try {
    const dir = extract();
    const resolved = createRequire(join(dir, "/")).resolve(id);
    return createRequire(resolved)(resolved);
  } catch (error) {
    // Callers such as Next's image optimizer catch this and fall back
    // silently, so log it here.
    if (!reported.has(id)) {
      reported.add(id);
      console.error(`⨯ Failed to load native package "${id}":`, error);
    }
    throw error;
  }
}

function extract(): string {
  if (extracted) return extracted;
  // Point this at a writable volume (an `emptyDir`) when the root filesystem
  // is read-only.
  const dir =
    process.env.NATIVE_MODULES_DIR ??
    join(tmpdir(), `next-native-${manifest.id}`);
  const stamp = join(dir, ".complete");
  if (!existsSync(stamp)) {
    for (const name of manifest.packages) {
      copyDir(
        join(appDir, "node_modules", name),
        join(dir, "node_modules", name),
      );
    }
    // Written last: a crash halfway through re-extracts on the next start.
    writeFileSync(stamp, manifest.id);
  }
  extracted = dir;
  return dir;
}

// `cpSync` opens file descriptors, which `/$bunfs` does not have. Copy with
// whole-file reads instead.
function copyDir(source: string, dest: string) {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(source)) {
    const from = join(source, entry);
    const to = join(dest, entry);
    if (statSync(from).isDirectory()) {
      copyDir(from, to);
    } else {
      writeFileSync(to, readFileSync(from));
    }
  }
}
