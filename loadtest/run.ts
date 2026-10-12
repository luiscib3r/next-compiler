// Load test: runs every k6 scenario against each variant, one at a time, with
// the same resource limits, and writes a report.
//
//   bun loadtest/run.ts                          # every variant and scenario
//   bun loadtest/run.ts --variants node=next-node --scenarios static,api
//
// A variant is `name=image`, or `name=image+redis` to give the server a Redis
// cache (`REDIS_URI`). Each scenario gets a fresh server, and a fresh, empty
// Redis when the variant uses one, so no scenario inherits the caches or the
// memory of the previous one. Redis counts as part of the system: its memory
// and CPU are measured too. k6 runs in a container on the same Docker network
// as the server, so Docker Desktop's port forwarding is not measured.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

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

type Usage = { memoryMiB: number; cpuPercent: number };

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
  redisMemoryMiB?: { avg: number; max: number };
  redisCpuPercent?: { avg: number; max: number };
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
    "docker", "run", "-d", "--name", REDIS_CONTAINER, "--network", NETWORK,
    "--cpus", "1", "--memory", "512m", REDIS_IMAGE,
    "redis-server", "--save", "", "--appendonly", "no",
    "--maxmemory", "384mb", "--maxmemory-policy", "allkeys-lru",
  ]);
  for (let i = 0; i < 100; i++) {
    const pong = await sh(["docker", "exec", REDIS_CONTAINER, "redis-cli", "ping"], {
      quiet: true,
    });
    if (pong.trim() === "PONG") return;
    await Bun.sleep(50);
  }
  throw new Error("Redis did not start");
}

async function startServer(variant: Variant): Promise<number> {
  await sh(["docker", "rm", "-f", CONTAINER], { quiet: true });
  const env = variant.redis ? ["-e", `REDIS_URI=redis://${REDIS_CONTAINER}:6379`] : [];
  const started = performance.now();
  await sh([
    "docker", "run", "-d", "--name", CONTAINER, "--network", NETWORK,
    "--cpus", values.cpus!, "--memory", values.memory!,
    "-p", `${HOST_PORT}:8080`, ...env, variant.image,
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

async function usage(container: string): Promise<Usage> {
  const line = await sh([
    "docker", "stats", "--no-stream", "--format",
    "{{.MemUsage}}|{{.CPUPerc}}", container,
  ]);
  return parseUsage(line);
}

function parseUsage(line: string): Usage {
  const [memory, cpu] = line.trim().split("|");
  const match = memory.match(/([\d.]+)\s*([KMG]i?B)/);
  const value = Number(match?.[1] ?? 0);
  const unit = match?.[2] ?? "MiB";
  const factor = unit.startsWith("G") ? 1024 : unit.startsWith("K") ? 1 / 1024 : 1;
  return { memoryMiB: value * factor, cpuPercent: Number.parseFloat(cpu) || 0 };
}

// Samples `docker stats` while k6 runs.
function sampleUsage(container: string) {
  const samples: Usage[] = [];
  const proc = Bun.spawn(
    ["docker", "stats", "--format", "{{.MemUsage}}|{{.CPUPerc}}", container],
    { stdout: "pipe", stderr: "ignore" },
  );
  (async () => {
    const decoder = new TextDecoder();
    const reader = proc.stdout.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      // `docker stats` redraws with ANSI escapes; keep the data lines.
      for (const raw of decoder.decode(value).split(/\r?\n/)) {
        const line = raw.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").trim();
        if (line.includes("|")) samples.push(parseUsage(line));
      }
    }
  })();
  return {
    stop() {
      proc.kill();
      return samples;
    },
  };
}

async function k6(scenario: string, duration: string, summary?: string) {
  const args = [
    "docker", "run", "--rm", "--network", NETWORK,
    "-v", `${loadtestDir}:/loadtest`,
    "-e", `BASE_URL=http://${CONTAINER}:8080`,
    "-e", `SCENARIO=${scenario}`,
    "-e", `VUS=${values.vus}`,
    "-e", `DURATION=${duration}`,
  ];
  if (summary) args.push("-e", `SUMMARY=/loadtest/results/tmp/${summary}`);
  args.push(K6_IMAGE, "run", "--quiet", "/loadtest/k6/script.js");
  await sh(args);
}

function stats(numbers: number[]) {
  if (!numbers.length) return { avg: 0, max: 0 };
  const sum = numbers.reduce((a, b) => a + b, 0);
  return { avg: sum / numbers.length, max: Math.max(...numbers) };
}

async function runScenario(variant: Variant, scenario: string) {
  if (variant.redis) await startRedis();
  const startupMs = await startServer(variant);
  await Bun.sleep(2000);
  const idle = await usage(CONTAINER);

  await k6(scenario, values.warmup!);

  const summaryFile = `${variant.name}-${scenario}.json`;
  const sampler = sampleUsage(CONTAINER);
  const redisSampler = variant.redis ? sampleUsage(REDIS_CONTAINER) : undefined;
  await k6(scenario, values.duration!, summaryFile);
  const samples = sampler.stop();
  const redisSamples = redisSampler?.stop();

  const summary = JSON.parse(readFileSync(join(tmpDir, summaryFile), "utf8"));
  const m = summary.metrics;
  const duration = m.http_req_duration.values;
  const result: ScenarioResult = {
    variant: variant.name,
    image: variant.image,
    redis: variant.redis,
    scenario,
    startupMs,
    idleMemoryMiB: idle.memoryMiB,
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
  if (redisSamples) {
    result.redisMemoryMiB = stats(redisSamples.map((s) => s.memoryMiB));
    result.redisCpuPercent = stats(redisSamples.map((s) => s.cpuPercent));
  }
  await sh(["docker", "rm", "-f", CONTAINER, REDIS_CONTAINER], { quiet: true });
  return result;
}

function report(results: ScenarioResult[]): string {
  const f = (n: number, digits = 1) => n.toFixed(digits);
  const lines = [
    `Límites por contenedor: ${values.cpus} CPU, ${values.memory} de memoria. ` +
      `k6: ${values.vus} VUs, ${values.duration} (+${values.warmup} de calentamiento).`,
    "",
    "Redis (cuando aplica): 1 CPU, 512 MiB, sin persistencia, `allkeys-lru`.",
    "",
    "| Escenario | Variante | req/s | p50 (ms) | p95 (ms) | p99 (ms) | Errores | RAM app prom / máx (MiB) | CPU app prom (%) | RAM Redis máx (MiB) | CPU Redis prom (%) |",
    "|---|---|---|---|---|---|---|---|---|---|---|",
  ];
  for (const r of results) {
    lines.push(
      `| ${r.scenario} | ${r.variant} | ${f(r.requestsPerSecond)} | ${f(r.latencyMs.med)} | ` +
        `${f(r.latencyMs.p95)} | ${f(r.latencyMs.p99)} | ${f(r.failedRate * 100, 2)} % | ` +
        `${f(r.memoryMiB.avg, 0)} / ${f(r.memoryMiB.max, 0)} | ${f(r.cpuPercent.avg, 0)} | ` +
        `${r.redisMemoryMiB ? f(r.redisMemoryMiB.max, 0) : "—"} | ` +
        `${r.redisCpuPercent ? f(r.redisCpuPercent.avg, 0) : "—"} |`,
    );
  }
  lines.push("", "| Variante | Arranque prom (ms) | RAM en reposo prom (MiB) |", "|---|---|---|");
  for (const variant of new Set(results.map((r) => r.variant))) {
    const own = results.filter((r) => r.variant === variant);
    lines.push(
      `| ${variant} | ${f(stats(own.map((r) => r.startupMs)).avg, 0)} | ` +
        `${f(stats(own.map((r) => r.idleMemoryMiB)).avg, 0)} |`,
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
// Interleave the variants per scenario, so a drift in the host (thermal
// throttling, background work) affects all of them alike.
for (const scenario of scenarios) {
  for (const variant of variants) {
    process.stdout.write(`${scenario} · ${variant.name} … `);
    const result = await runScenario(variant, scenario);
    console.log(
      `${result.requestsPerSecond.toFixed(1)} req/s, p95 ${result.latencyMs.p95.toFixed(1)} ms, ` +
        `RAM máx ${result.memoryMiB.max.toFixed(0)} MiB`,
    );
    results.push(result);
  }
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = join(loadtestDir, "results");
writeFileSync(join(outDir, `${stamp}.json`), JSON.stringify({ config: values, results }, null, 2));
writeFileSync(join(outDir, `${stamp}.md`), report(results) + "\n");
rmSync(tmpDir, { recursive: true, force: true });
console.log(`\n${report(results)}\n\nResultados en loadtest/results/${stamp}.{json,md}`);
