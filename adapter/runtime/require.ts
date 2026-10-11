import { existsSync, readFileSync, statSync } from "node:fs";
import Module, { createRequire } from "node:module";
import { dirname, isAbsolute, join, resolve } from "node:path";
import vm from "node:vm";
import { isNative, requireNative } from "./native";

const original = Module.prototype.require;

type CommonJsModule = {
  exports: Record<string, unknown>;
};

const modules = new Map<string, CommonJsModule>();

Module.prototype.require = function (id: string) {
  if (isNative(id)) return requireNative(id);
  if (id.includes("$bunfs")) return loadFile(id);
  return original.call(this, id);
};

function loadFile(filename: string): unknown {
  if (filename.endsWith(".json")) {
    return JSON.parse(readFileSync(filename, "utf8"));
  }
  return loadCommonJs(filename);
}

// Bun evaluates `.js` files in `/$bunfs` as ESM. Next's server output is
// CommonJS (`require`, `module.exports`), so run those files as CommonJS.
function loadCommonJs(filename: string): unknown {
  const cached = modules.get(filename);
  if (cached) return cached.exports;

  const loaded: CommonJsModule = { exports: {} };
  modules.set(filename, loaded);
  try {
    const source = readFileSync(filename, "utf8");
    const wrapped = `(function (exports, require, module, __filename, __dirname) {\n${source}\n})`;
    vm.runInThisContext(wrapped, {
      filename,
      importModuleDynamically: (specifier) => bunfsImport(filename, specifier),
    })(
      loaded.exports,
      bunfsRequire(filename),
      loaded,
      filename,
      dirname(filename),
    );
  } catch (error) {
    modules.delete(filename);
    throw error;
  }
  return loaded.exports;
}

// Code run through `vm` has no `import()` unless the script provides one.
// Turbopack loads ESM externals (such as `next/dist/compiled/@vercel/og`) with
// `import()`. Resolve the specifier like `require` does, then let Bun load the
// file: Bun evaluates `.js` files in `/$bunfs` as ESM, which is what they are.
function bunfsImport(filename: string, specifier: string) {
  if (Module.isBuiltin(specifier)) return import(specifier);
  const resolved = resolveFrom(dirname(filename), specifier);
  return import(resolved ?? specifier);
}

// `createRequire` resolves relative and absolute paths in `/$bunfs`, but Bun
// does not search `node_modules` there. Resolve bare specifiers by hand.
function bunfsRequire(filename: string) {
  const dir = dirname(filename);
  const fallback = createRequire(filename);
  const require = (id: string) => {
    if (Module.isBuiltin(id)) return fallback(id);
    if (isNative(id)) return requireNative(id);
    const resolved = resolveFrom(dir, id);
    if (!resolved) return fallback(id);
    return loadFile(resolved);
  };
  require.resolve = (id: string) => {
    if (Module.isBuiltin(id)) return id;
    const resolved = resolveFrom(dir, id);
    if (!resolved) {
      throw new Error(`Cannot find module '${id}' from '${filename}'`);
    }
    return resolved;
  };
  return require;
}

function resolveFrom(dir: string, id: string): string | undefined {
  if (id.startsWith(".") || isAbsolute(id)) {
    return resolveFile(resolve(dir, id));
  }
  const [name, subpath] = splitPackage(id);
  for (let current = dir; ; current = dirname(current)) {
    const packageDir = join(current, "node_modules", name);
    if (existsSync(join(packageDir, "package.json"))) {
      return resolvePackage(packageDir, subpath);
    }
    if (current === dirname(current)) return undefined;
  }
}

function splitPackage(id: string): [string, string] {
  const parts = id.split("/");
  const length = id.startsWith("@") ? 2 : 1;
  const subpath = parts.slice(length).join("/");
  return [parts.slice(0, length).join("/"), subpath ? `./${subpath}` : "."];
}

type PackageJson = {
  main?: string;
  exports?: unknown;
};

const CONDITIONS = ["node", "require", "default"];

function resolvePackage(packageDir: string, subpath: string) {
  const pkg = JSON.parse(
    readFileSync(join(packageDir, "package.json"), "utf8"),
  ) as PackageJson;
  if (pkg.exports !== undefined) {
    const target = resolveExports(pkg.exports, subpath);
    if (target) return resolveFile(join(packageDir, target));
  }
  if (subpath === ".") {
    return resolveFile(join(packageDir, pkg.main ?? "index.js"));
  }
  return resolveFile(join(packageDir, subpath));
}

function resolveExports(exports: unknown, subpath: string): string | undefined {
  if (typeof exports === "string" || Array.isArray(exports)) {
    return subpath === "." ? resolveTarget(exports) : undefined;
  }
  const map = exports as Record<string, unknown>;
  if (!Object.keys(map).some((key) => key.startsWith("."))) {
    return subpath === "." ? resolveTarget(map) : undefined;
  }
  if (subpath in map) return resolveTarget(map[subpath]);
  for (const [key, value] of Object.entries(map)) {
    const star = key.indexOf("*");
    if (star === -1) continue;
    const prefix = key.slice(0, star);
    const suffix = key.slice(star + 1);
    if (subpath.startsWith(prefix) && subpath.endsWith(suffix)) {
      const match = subpath.slice(
        prefix.length,
        subpath.length - suffix.length,
      );
      return resolveTarget(value)?.replaceAll("*", match);
    }
  }
  return undefined;
}

function resolveTarget(target: unknown): string | undefined {
  if (typeof target === "string") return target;
  if (Array.isArray(target)) {
    for (const item of target) {
      const resolved = resolveTarget(item);
      if (resolved) return resolved;
    }
    return undefined;
  }
  if (target && typeof target === "object") {
    for (const [condition, value] of Object.entries(target)) {
      if (CONDITIONS.includes(condition)) {
        const resolved = resolveTarget(value);
        if (resolved) return resolved;
      }
    }
  }
  return undefined;
}

function resolveFile(path: string): string | undefined {
  for (const candidate of [path, `${path}.js`, `${path}.json`]) {
    if (isFile(candidate)) return candidate;
  }
  const packageJson = join(path, "package.json");
  if (isFile(packageJson)) {
    const { main } = JSON.parse(
      readFileSync(packageJson, "utf8"),
    ) as PackageJson;
    if (main) {
      const resolved = resolveFile(join(path, main));
      if (resolved) return resolved;
    }
  }
  for (const index of ["index.js", "index.json"]) {
    const candidate = join(path, index);
    if (isFile(candidate)) return candidate;
  }
  return undefined;
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}
