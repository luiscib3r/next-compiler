// Load test: runs every k6 scenario against each variant, one at a time, with
// the same resource limits, and writes a report.
//
//   bun loadtest/run.ts                          # every variant and scenario
//   bun loadtest/run.ts --variants node=next-node --scenarios static,api
//   bun loadtest/run.ts --repeat 3               # median and spread of 3 runs
//
// A variant is `name=image`, or `name=image+redis` to give the server a Redis
// cache (`REDIS_URI`). Each scenario gets a fresh server, and a fresh, empty
// Redis when the variant uses one, so no scenario inherits the caches or the
// memory of the previous one. Redis counts as part of the system: the data it
// holds (`INFO memory`, not the container's memory) and its CPU are measured.
//
// With `--repeat`, every run is repeated and the report shows the median and
// the spread (max/min - 1) of each metric, so the noise is measured, not
// guessed. k6 runs in a container on the same Docker network
// as the server, so Docker Desktop's port forwarding is not measured.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { median, sampleUsage, stats, usage } from "./lib";

const { values } = parseArgs({
  options: {
    variants: {
      type: "string",
      default: "bun=next-compiler,bun-redis=next-compiler+redis,node=next-node",
    },
    scenarios: {
      type: "string",
      default: "static,dynamic,cache,api,asset,isr-new,image",
    },
    vus: { type: "string", default: "32" },
    duration: { type: "string", default: "30s" },
    warmup: { type: "string", default: "10s" },
    repeat: { type: "string", default: "1" },
    cpus: { type: "string", default: "1" },
    memory: { type: "string", default: "1g" },
  },
});

const K6_IMAGE = "grafana/k6:2.3.0";
const REDIS_IMAGE = "redis:8.2-alpine";
const NETWORK = "next-bench";
const CONTAINER = "next-bench-app";
const REDIS_CONTAINER = "next-bench-redis";
const HOST_PORT = 18080;
const loadtestDir = import.meta.dir;
const tmpDir = join(loadtestDir, "results", "tmp");

type Variant = { name: string; image: string; redis: boolean };

type ScenarioResult = {
  variant: string;
  image: string;
  redis: boolean;
  scenario: string;
  startupMs: number;
  idleMemoryMiB: number;
  requestsPerSecond: number;
  latencyMs: { med: number; p95: number; p99: number; max: number };
  failedRate: number;
  checksFailed: number;
  memoryMiB: { avg: number; max: number };
  cpuPercent: { avg: number; max: number };
  // From Redis itself: the data it holds, not the container's memory, which
  // at this scale mostly measures the allocator and the kernel.
  redisDataPeakMiB?: number;
  redisKeys?: number;
  redisCpuPercent?: { avg: number; max: number };
  repetition: number;
};

async function sh(args: string[], options: { quiet?: boolean } = {}) {
  const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0 && !options.quiet) {
    throw new Error(`${args.join(" ")} failed (${code}):\n${stderr}`);
  }
  return stdout;
}

// An empty Redis used only as a cache: no persistence, evicts the least
// recently used keys when full, as the adapter expects.
async function startRedis() {
  await sh(["docker", "rm", "-f", REDIS_CONTAINER], { quiet: true });
  await sh([
    "docker",
    "run",
    "-d",
    "--name",
    REDIS_CONTAINER,
    "--network",
    NETWORK,
    "--cpus",
    "1",
    "--memory",
    "512m",
    REDIS_IMAGE,
    "redis-server",
    "--save",
    "",
    "--appendonly",
    "no",
    "--maxmemory",
    "384mb",
    "--maxmemory-policy",
    "allkeys-lru",
  ]);
  for (let i = 0; i < 100; i++) {
    const pong = await sh(
      ["docker", "exec", REDIS_CONTAINER, "redis-cli", "ping"],
      {
        quiet: true,
      },
    );
    if (pong.trim() === "PONG") return;
    await Bun.sleep(50);
  }
  throw new Error("Redis did not start");
}

async function startServer(variant: Variant): Promise<number> {
  await sh(["docker", "rm", "-f", CONTAINER], { quiet: true });
  const env = variant.redis
    ? ["-e", `REDIS_URI=redis://${REDIS_CONTAINER}:6379`]
    : [];
  const started = performance.now();
  await sh([
    "docker",
    "run",
    "-d",
    "--name",
    CONTAINER,
    "--network",
    NETWORK,
    "--cpus",
    values.cpus!,
    "--memory",
    values.memory!,
    "-p",
    `${HOST_PORT}:8080`,
    ...env,
    variant.image,
  ]);
  // Ready when the server answers its first request.
  for (;;) {
    try {
      const response = await fetch(`http://localhost:${HOST_PORT}/static`);
      if (response.ok) return performance.now() - started;
    } catch {}
    if (performance.now() - started > 60_000) {
      throw new Error(`${variant.name} did not start in 60s`);
    }
    await Bun.sleep(25);
  }
}

async function k6(scenario: string, duration: string, summary?: string) {
  const args = [
    "docker",
    "run",
    "--rm",
    "--network",
    NETWORK,
    "-v",
    `${loadtestDir}:/loadtest`,
    "-e",
    `BASE_URL=http://${CONTAINER}:8080`,
    "-e",
    `SCENARIO=${scenario}`,
    "-e",
    `VUS=${values.vus}`,
    "-e",
    `DURATION=${duration}`,
  ];
  if (summary) args.push("-e", `SUMMARY=/loadtest/results/tmp/${summary}`);
  args.push(K6_IMAGE, "run", "--quiet", "/loadtest/k6/script.js");
  await sh(args);
}

// Idle memory right after start depends on when the garbage collector last
// ran. Let the process settle, then take the median of several samples.
async function idleMemory(container: string) {
  await Bun.sleep(5_000);
  const samples: number[] = [];
  for (let i = 0; i < 5; i++) {
    samples.push((await usage(container)).memoryMiB);
    await Bun.sleep(1_000);
  }
  return median(samples);
}

async function redisData() {
  const info = await sh([
    "docker",
    "exec",
    REDIS_CONTAINER,
    "redis-cli",
    "info",
    "memory",
  ]);
  const peak = Number(info.match(/^used_memory_peak:(\d+)/m)?.[1] ?? 0);
  const keys = Number(
    (
      await sh(["docker", "exec", REDIS_CONTAINER, "redis-cli", "dbsize"])
    ).trim(),
  );
  return { peakMiB: peak / 1024 / 1024, keys };
}

async function runScenario(
  variant: Variant,
  scenario: string,
  repetition: number,
) {
  if (variant.redis) await startRedis();
  const startupMs = await startServer(variant);
  const idleMemoryMiB = await idleMemory(CONTAINER);

  await k6(scenario, values.warmup!);

  const summaryFile = `${variant.name}-${scenario}-${repetition}.json`;
  const sampler = sampleUsage(CONTAINER);
  const redisSampler = variant.redis ? sampleUsage(REDIS_CONTAINER) : undefined;
  await k6(scenario, values.duration!, summaryFile);
  const samples = sampler.stop();
  const redisSamples = redisSampler?.stop();
  const redis = variant.redis ? await redisData() : undefined;

  const summary = JSON.parse(readFileSync(join(tmpDir, summaryFile), "utf8"));
  const m = summary.metrics;
  const duration = m.http_req_duration.values;
  const result: ScenarioResult = {
    variant: variant.name,
    image: variant.image,
    redis: variant.redis,
    scenario,
    repetition,
    startupMs,
    idleMemoryMiB,
    requestsPerSecond: m.http_reqs.values.rate,
    latencyMs: {
      med: duration.med,
      p95: duration["p(95)"],
      p99: duration["p(99)"],
      max: duration.max,
    },
    failedRate: m.http_req_failed.values.rate,
    checksFailed: m.checks.values.fails,
    memoryMiB: stats(samples.map((s) => s.memoryMiB)),
    cpuPercent: stats(samples.map((s) => s.cpuPercent)),
  };
  if (redis && redisSamples) {
    result.redisDataPeakMiB = redis.peakMiB;
    result.redisKeys = redis.keys;
    result.redisCpuPercent = stats(redisSamples.map((s) => s.cpuPercent));
  }
  await sh(["docker", "rm", "-f", CONTAINER, REDIS_CONTAINER], { quiet: true });
  return result;
}

function report(results: ScenarioResult[]): string {
  const f = (n: number, digits = 1) => n.toFixed(digits);
  const runs = Number(values.repeat);
  // "median (spread)": the spread is max/min - 1 across repetitions.
  const summarize = (numbers: number[], digits = 1) => {
    const mid = f(median(numbers), digits);
    if (numbers.length < 2) return mid;
    const spread = (Math.max(...numbers) / Math.min(...numbers) - 1) * 100;
    return `${mid} (±${f(spread / 2, 0)} %)`;
  };
  const lines = [
    `Límites por contenedor: ${values.cpus} CPU, ${values.memory} de memoria. ` +
      `k6: ${values.vus} VUs, ${values.duration} (+${values.warmup} de calentamiento). ` +
      `Repeticiones: ${runs}${runs > 1 ? " (mediana, y entre paréntesis la mitad del rango)" : ""}.`,
    "",
    "Redis (cuando aplica): 1 CPU, 512 MiB, sin persistencia, `allkeys-lru`. Datos medidos con `INFO memory`.",
    "RAM de la app: memoria privada del proceso (`anon` del cgroup), sin la caché de páginas de archivos.",
    "",
    "| Escenario | Variante | req/s | p50 (ms) | p95 (ms) | p99 (ms) | Errores | RAM app máx, anon (MiB) | CPU app prom (%) | Datos Redis pico (MiB) | Claves Redis | CPU Redis prom (%) |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|",
  ];
  const groups = new Map<string, ScenarioResult[]>();
  for (const r of results) {
    const key = `${r.scenario}|${r.variant}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  for (const own of groups.values()) {
    const r = own[0];
    const pick = (fn: (x: ScenarioResult) => number) => own.map(fn);
    lines.push(
      `| ${r.scenario} | ${r.variant} | ${summarize(pick((x) => x.requestsPerSecond))} | ` +
        `${f(median(pick((x) => x.latencyMs.med)))} | ${summarize(pick((x) => x.latencyMs.p95))} | ` +
        `${summarize(pick((x) => x.latencyMs.p99))} | ` +
        `${f(Math.max(...pick((x) => x.failedRate)) * 100, 2)} % | ` +
        `${f(median(pick((x) => x.memoryMiB.max)), 0)} | ` +
        `${f(median(pick((x) => x.cpuPercent.avg)), 0)} | ` +
        `${r.redis ? f(median(pick((x) => x.redisDataPeakMiB ?? 0))) : "—"} | ` +
        `${r.redis ? f(median(pick((x) => x.redisKeys ?? 0)), 0) : "—"} | ` +
        `${r.redis ? f(median(pick((x) => x.redisCpuPercent?.avg ?? 0)), 0) : "—"} |`,
    );
  }
  lines.push(
    "",
    "| Variante | Arranque mediana (ms) | RAM en reposo, anon, mediana (MiB) |",
    "|---|---|---|",
  );
  for (const variant of new Set(results.map((r) => r.variant))) {
    const own = results.filter((r) => r.variant === variant);
    lines.push(
      `| ${variant} | ${summarize(
        own.map((r) => r.startupMs),
        0,
      )} | ` +
        `${summarize(
          own.map((r) => r.idleMemoryMiB),
          0,
        )} |`,
    );
  }
  return lines.join("\n");
}

mkdirSync(tmpDir, { recursive: true });
await sh(["docker", "network", "create", NETWORK], { quiet: true });

const results: ScenarioResult[] = [];
const scenarios = values.scenarios!.split(",");
const variants: Variant[] = values.variants!.split(",").map((spec) => {
  const [name, target] = spec.split("=");
  const [image, extra] = target.split("+");
  return { name, image, redis: extra === "redis" };
});
// Interleave the variants per scenario, and the repetitions around the whole
// suite, so a drift in the host (thermal throttling, background work) affects
// every variant alike instead of piling up on one.
for (let repetition = 1; repetition <= Number(values.repeat); repetition++) {
  for (const scenario of scenarios) {
    for (const variant of variants) {
      process.stdout.write(`[${repetition}] ${scenario} · ${variant.name} … `);
      const result = await runScenario(variant, scenario, repetition);
      console.log(
        `${result.requestsPerSecond.toFixed(1)} req/s, p95 ${result.latencyMs.p95.toFixed(1)} ms, ` +
          `RAM máx ${result.memoryMiB.max.toFixed(0)} MiB`,
      );
      results.push(result);
    }
  }
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = join(loadtestDir, "results");
writeFileSync(
  join(outDir, `${stamp}.json`),
  JSON.stringify({ config: values, results }, null, 2),
);
writeFileSync(join(outDir, `${stamp}.md`), report(results) + "\n");
rmSync(tmpDir, { recursive: true, force: true });
console.log(
  `\n${report(results)}\n\nResultados en loadtest/results/${stamp}.{json,md}`,
);
