// Next's `.external` modules must be a single instance, shared by the server
// and the route bundles: some keep state at module level (`tagsManifest`, the
// memory cache, loaded manifests). `adapter/generate.ts` overwrites this file
// with a lazy `require()` of each one the build uses, so Bun bundles them once
// and `require.ts` hands that instance to every chunk instead of loading a
// second copy from `/$bunfs`.
export const externals: Record<string, () => unknown> = {};
