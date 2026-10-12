# Next.js in a single binary

A [Next.js Build Adapter](https://nextjs.org/docs/app/api-reference/config/next-config-js/adapterPath) that compiles a Next.js 16 app into **one self-contained [Bun](https://bun.sh) executable**: the server, the app and every file it needs, embedded. The binary runs on a `distroless` image, without Node.js, `node_modules` or a shell, and is meant for Kubernetes.

This repository is the adapter, a test app that exercises most of Next.js, and the tooling used to measure it against the classic Next.js standalone server on Node.js.

> [!NOTE]
> This is an experiment and a learning project, not a published package.

## Results so far

Measured on [OrbStack](https://orbstack.dev/) (a Linux VM on macOS), same app, same cache architecture. The raw results are in `loadtest/results/`.

| | Bun binary | Node.js standalone |
|---|---|---|
| Docker image (uncompressed / compressed) | 163 MB / 65 MB | 224 MB / 77 MB |
| Requests per CPU, Kubernetes, 8 replicas, same CPU limit | **2.4–2.6×** | 1× |
| Idle memory per pod | 48 MiB | 47 MiB |
| Startup to first response | ~0.4 s | ~0.55 s |

Under load, the binary uses more memory per pod than Node.js (102–262 MiB against 84–137 MiB) while it serves 1.6–2.6 times more requests.

## Requirements

- [Bun](https://bun.sh) 1.4.3 (it runs the build and compiles the binary)
- Docker ([OrbStack](https://orbstack.dev/) or Docker Desktop on macOS)
- For Kubernetes: `kubectl` and [Tilt](https://tilt.dev/), and a local cluster (OrbStack's, Docker Desktop's, kind or minikube)

The versions are pinned on purpose: the adapter relies on Next.js internals (16.4) and on Bun behaviors (1.4.3) that are not public contracts. See [Limitations](#limitations).

## Quick start

```bash
bun install
bun run build            # next build + the adapter → build/server
PORT=8080 ./build/server
bun run smoke            # checks every page of the test app on :8080
```

The binary is built for the machine that runs the build. For Linux, build the image:

```bash
docker build -t next-compiler .
docker run --rm -p 8080:8080 next-compiler
```

With the shared Redis cache:

```bash
docker compose up
```

## Configuration

Everything the binary does at runtime is decided by its environment, so the same artifact serves every environment.

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `8080` | Port to listen on |
| `HOST` | `0.0.0.0` | Interface to listen on. Not `HOSTNAME`: Kubernetes sets it to the pod name |
| `REDIS_URI` | — | Turns on the shared cache in Redis (e.g. `redis://redis:6379`). Without it, the cache stays in the process |
| `NATIVE_MODULES_DIR` | OS temp dir | Where native packages (`sharp`) are extracted the first time they are needed. Must be writable and allow executing code (not `noexec`) |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | — | Turns on OpenTelemetry, exporting over OTLP/HTTP (e.g. `http://jaeger:4318`) |
| `OTEL_SERVICE_NAME` | `next-compiler` | Service name in the traces |
| `NEXT_PRIVATE_DEBUG_CACHE` | — | Next's switch for cache logs; the Redis cache handlers log their decisions too |

At build time, in `next.config.ts`:

| Setting | Effect |
|---|---|
| (default) | The adapter compiles the app into `build/server` |
| `BUILD_TARGET=node` | Classic Next.js `output: "standalone"` for Node.js, without the adapter (`Dockerfile.node`) |
| `BUILD_TARGET=node BUILD_CACHE=redis` | The same, with a Redis cache handler equivalent to the binary's (`--build-arg BUILD_CACHE=redis`) |
| `images.unoptimized: true` | Leaves `sharp` and its native binaries out of the binary |

## How it works

The adapter hooks into the end of `next build` (`onBuildComplete`):

1. **Stage** (`adapter/stage.ts`) copies what the server needs: the build output, the traced files from `node_modules` and the static files. It skips source maps, build traces and native binaries for other platforms.
2. **Generate** (`adapter/generate.ts`) writes the runtime entry, the serialized Next.js config and a list of Next's `.external` modules.
3. **Compile** (`adapter/compile.ts`) runs `Bun.build()` with `compile`, embedding the staged app in the executable. A plugin leaves out the modules Next.js only uses in `next dev` (webpack, babel, the dev overlay).

Inside the binary, the embedded files live in Bun's virtual filesystem, `/$bunfs`. Most of the runtime (`adapter/runtime/`) exists to make Next.js work there:

| File | Why |
|---|---|
| `require.ts` | Bun evaluates `.js` files in `/$bunfs` as ES modules and does not look up `node_modules` there. This runs Next's CommonJS chunks and resolves package names, including `import()` |
| `externals.ts` | Next's `.external` modules must be one instance shared by the server and the route bundles; the resolver hands every chunk the bundled one |
| `fs.ts` | Files in `/$bunfs` have no file descriptors, so `createReadStream` (used to serve static files) reads them from memory |
| `native.ts` | Native addons need a real file for `dlopen` and their shared libraries next to them: they are extracted to disk on first use |
| `cache/` | The Redis cache handlers: pages, ISR, route handlers, `fetch`, `"use cache"` and optimized images, shared by every replica of a build |

## Kubernetes

```bash
tilt up
```

Tilt builds both images and deploys, in the `next-compiler` namespace:

| Resource | |
|---|---|
| `next-bun` | 8 replicas of the binary, with Redis and OpenTelemetry |
| `next-node` | 8 replicas of Node.js standalone with the Redis cache handler |
| `redis` | The shared cache (no persistence, `allkeys-lru`) |
| `jaeger` | Traces, UI on <http://localhost:16686> |

Port forwards: `next-bun` on 18080, `next-node` on 18081. A port forward reaches **a single pod**: for anything that should spread across the replicas, go through the Services from inside the cluster.

## Tests

**Test app.** Each page under `app/` exercises one Next.js feature the binary must support: static and dynamic rendering, streaming, `"use cache"`, ISR, Server Actions, `proxy.ts`, redirects and rewrites, errors, `next/image`, Open Graph images, metadata routes and route handlers. The list lives in `app/lib/tests.ts`.

```bash
bun run smoke [url]      # default http://localhost:8080
```

**Load tests** with [k6](https://k6.io/), one scenario per kind of work (`loadtest/k6/script.js`):

```bash
# Docker: each variant in a fresh container with the same CPU and memory limits
bun loadtest/run.ts --variants bun=next-compiler+redis,node=next-node-redis+redis --repeat 3

# Kubernetes: k6 runs as a Job inside the cluster, against the Services
bun loadtest/k8s.ts --repeat 2     # or the `loadtest` button in Tilt
```

Memory is the process's own (`anon`), read from the Docker API: `docker stats` also counts the page cache of the files a container read, which changes with what ran before. Results go to `loadtest/results/`.

## Repository layout

```
adapter/                The Build Adapter
  runtime/              Code compiled into the binary
cache-handlers/node-redis/  Redis cache handler for the Node.js build
app/                    Test app (one page per feature)
instrumentation.ts      OpenTelemetry
proxy.ts                Proxy (formerly middleware) for the test app
k8s/                    Kubernetes manifests (and the k6 Job)
loadtest/               Load test runners, k6 script and results
scripts/smoke.ts        Smoke test
Dockerfile              The binary on distroless/cc
Dockerfile.node         Next.js standalone on distroless/nodejs (comparison)
Tiltfile                The Kubernetes environment
```

## Limitations

- **Coupled to internals.** The adapter depends on Next.js internals (the Turbopack runtime, the `.external` naming convention, the incremental cache) and on Bun behaviors (how `/$bunfs` works) that are not public APIs. Upgrades of either need the smoke test and the load tests before anything else.
- **One platform per build.** The binary and its native packages match the machine that built them. Build inside Docker to get Linux binaries.
- **No reading files from disk at runtime.** `process.cwd()` is the container's directory, not the embedded filesystem. Load static data with `import`.
- **Native packages are a fixed list** (`sharp`). Another package with a native addon needs to be added to `adapter/index.ts`.
- **OpenTelemetry exports over HTTP only.** gRPC works, inside the binary as well, but its exporter breaks ISR background revalidation with Cache Components, on Node.js too.
- **Tested on one machine.** Every measurement so far ran on OrbStack on macOS, and Kubernetes on a single node.

## License

[MIT](LICENSE)
