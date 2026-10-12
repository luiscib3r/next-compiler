// Load test inside Kubernetes: k6 runs as a Job in the cluster and targets
// the Services, so kube-proxy spreads the connections across the replicas.
// (`kubectl port-forward svc/...` would not: it picks a single pod.)
//
//   tilt up                                       # or `tilt ci`
//   bun loadtest/k8s.ts                           # both variants, every scenario
//   bun loadtest/k8s.ts --variants next-bun --scenarios static --repeat 3
//
// One variant runs at a time, with the others scaled to zero, so they never
// compete for the node. Before every run the variant's pods restart and
// Redis is flushed. Pod memory (`anon`) and CPU come from the Docker API:
// OrbStack and Docker Desktop run the pods on the local Docker daemon.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { median, sampleUsage, stats, usage, type Usage } from "./lib";

const { values } = parseArgs({
  options: {
    variants: { type: "string", default: "next-bun,next-node" },
    scenarios: {
      type: "string",
      default: "static,dynamic,cache,api,asset,isr-new,image",
    },
    replicas: { type: "string", default: "8" },
    vus: { type: "string", default: "64" },
    duration: { type: "string", default: "30s" },
    warmup: { type: "string", default: "10s" },
    repeat: { type: "string", default: "1" },
  },
});

const NAMESPACE = "next-compiler";
const K6_IMAGE = "grafana/k6:2.3.0";
const SUMMARY_MARKER = "@@K6_SUMMARY@@";
const loadtestDir = import.meta.dir;
const allVariants = ["next-bun", "next-node"];

type Result = {
  variant: string;
  scenario: string;
  repetition: number;
  replicas: number;
  requestsPerSecond: number;
  latencyMs: { med: number; p95: number; p99: number; max: number };
  failedRate: number;
  // Across the variant's pods, sampled about once a second.
  memoryTotalMiB: { max: number }; // sum of every pod's `anon`
  memoryPodMiB: { max: number }; // the largest single pod
  cpuTotalPercent: { avg: number }; // sum of every pod's CPU, 100 % = 1 CPU
  cpuPodPercent: { min: number; max: number }; // average per pod: the spread
  idlePodMiB: number;
  redisDataPeakMiB: number;
  redisKeys: number;
};

async function sh(
  args: string[],
  options: { quiet?: boolean; input?: string } = {},
) {
  const proc = Bun.spawn(args, {
    stdin: options.input ? new Blob([options.input]) : undefined,
    stdout: "pipe",
    stderr: "pipe",
  });
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

const kubectl = (...args: string[]) =>
  sh(["kubectl", "-n", NAMESPACE, ...args]);

async function prepare(variant: string, replicas: number) {
  for (const other of allVariants.filter((v) => v !== variant)) {
    await kubectl("scale", `deploy/${other}`, "--replicas=0");
  }
  await kubectl("scale", `deploy/${variant}`, `--replicas=${replicas}`);
  // Fresh pods: no memory or in-process state left from the previous run.
  await kubectl("rollout", "restart", `deploy/${variant}`);
  await kubectl("rollout", "status", `deploy/${variant}`, "--timeout=180s");
  // Wait for the old pods to be gone, so only the new ones are measured.
  for (let i = 0; i < 120; i++) {
    if ((await podContainers(variant)).length === replicas) break;
    await Bun.sleep(1_000);
  }
  await kubectl("exec", "deploy/redis", "--", "redis-cli", "FLUSHALL");
}

// The Docker containers that run the variant's app container.
async function podContainers(variant: string): Promise<string[]> {
  const out = await sh([
    "docker",
    "ps",
    "--filter",
    `label=io.kubernetes.pod.namespace=${NAMESPACE}`,
    "--filter",
    "label=io.kubernetes.container.name=next",
    "--format",
    '{{.ID}} {{.Label "io.kubernetes.pod.name"}}',
  ]);
  return out
    .trim()
    .split("\n")
    .filter((line) => line.split(" ")[1]?.startsWith(`${variant}-`))
    .map((line) => line.split(" ")[0]);
}

async function idleMemory(containers: string[]) {
  await Bun.sleep(5_000);
  const perPod: number[] = [];
  for (const id of containers) {
    const samples: number[] = [];
    for (let i = 0; i < 3; i++) samples.push((await usage(id)).memoryMiB);
    perPod.push(median(samples));
  }
  return median(perPod);
}

async function runK6(
  name: string,
  variant: string,
  scenario: string,
  duration: string,
) {
  const job = {
    apiVersion: "batch/v1",
    kind: "Job",
    metadata: { name, namespace: NAMESPACE },
    spec: {
      backoffLimit: 0,
      ttlSecondsAfterFinished: 300,
      template: {
        spec: {
          restartPolicy: "Never",
          containers: [
            {
              name: "k6",
              image: K6_IMAGE,
              imagePullPolicy: "IfNotPresent",
              args: ["run", "--quiet", "/scripts/script.js"],
              env: [
                { name: "BASE_URL", value: `http://${variant}` },
                { name: "SCENARIO", value: scenario },
                { name: "VUS", value: values.vus },
                { name: "DURATION", value: duration },
                { name: "SUMMARY", value: "stdout" },
              ],
              // Enough to generate the load without competing with the pods.
              resources: {
                requests: { cpu: "1", memory: "256Mi" },
                limits: { cpu: "2", memory: "1Gi" },
              },
              volumeMounts: [{ name: "scripts", mountPath: "/scripts" }],
            },
          ],
          volumes: [{ name: "scripts", configMap: { name: "k6-script" } }],
        },
      },
    },
  };
  await kubectl("delete", "job", name, "--ignore-not-found");
  await sh(["kubectl", "apply", "-f", "-"], { input: JSON.stringify(job) });
  await kubectl(
    "wait",
    "--for=condition=complete",
    `job/${name}`,
    "--timeout=600s",
  );
  const logs = await kubectl("logs", `job/${name}`);
  await kubectl("delete", "job", name, "--ignore-not-found");
  const line = logs.split("\n").find((l) => l.startsWith(SUMMARY_MARKER));
  return line ? JSON.parse(line.slice(SUMMARY_MARKER.length)) : undefined;
}

async function redisData() {
  const info = await kubectl(
    "exec",
    "deploy/redis",
    "--",
    "redis-cli",
    "info",
    "memory",
  );
  // Current, not peak: Redis is flushed between runs, not restarted, and the
  // peak survives a FLUSHALL.
  const peak = Number(info.match(/^used_memory:(\d+)/m)?.[1] ?? 0);
  const keys = Number(
    (await kubectl("exec", "deploy/redis", "--", "redis-cli", "dbsize")).trim(),
  );
  return { peakMiB: peak / 1024 / 1024, keys };
}

async function runOne(
  variant: string,
  scenario: string,
  repetition: number,
): Promise<Result> {
  const replicas = Number(values.replicas);
  await prepare(variant, replicas);
  const containers = await podContainers(variant);
  const idlePodMiB = await idleMemory(containers);

  const tag = `${variant}-${scenario}-${repetition}`.replace(/[^a-z0-9-]/g, "");
  await runK6(`k6-warmup-${tag}`, variant, scenario, values.warmup!);

  const samplers = containers.map((id) => sampleUsage(id));
  const summary = await runK6(`k6-${tag}`, variant, scenario, values.duration!);
  const perPod: Usage[][] = samplers.map((s) => s.stop());
  if (!summary) throw new Error(`no k6 summary for ${tag}`);

  // Sum the pods sample by sample (they are sampled about once a second).
  const length = Math.min(...perPod.map((s) => s.length));
  const totals = Array.from({ length }, (_, i) => ({
    memoryMiB: perPod.reduce((sum, s) => sum + s[i].memoryMiB, 0),
    cpuPercent: perPod.reduce((sum, s) => sum + s[i].cpuPercent, 0),
  }));
  const podCpu = perPod.map((s) => stats(s.map((x) => x.cpuPercent)).avg);
  const redis = await redisData();

  const m = summary.metrics;
  const duration = m.http_req_duration.values;
  return {
    variant,
    scenario,
    repetition,
    replicas,
    requestsPerSecond: m.http_reqs.values.rate,
    latencyMs: {
      med: duration.med,
      p95: duration["p(95)"],
      p99: duration["p(99)"],
      max: duration.max,
    },
    failedRate: m.http_req_failed.values.rate,
    memoryTotalMiB: { max: Math.max(...totals.map((t) => t.memoryMiB)) },
    memoryPodMiB: { max: Math.max(...perPod.flat().map((x) => x.memoryMiB)) },
    cpuTotalPercent: { avg: stats(totals.map((t) => t.cpuPercent)).avg },
    cpuPodPercent: { min: Math.min(...podCpu), max: Math.max(...podCpu) },
    idlePodMiB,
    redisDataPeakMiB: redis.peakMiB,
    redisKeys: redis.keys,
  };
}

function report(results: Result[]): string {
  const f = (n: number, digits = 1) => n.toFixed(digits);
  const runs = Number(values.repeat);
  const summarize = (numbers: number[], digits = 1) => {
    const mid = f(median(numbers), digits);
    if (numbers.length < 2) return mid;
    const spread = (Math.max(...numbers) / Math.min(...numbers) - 1) * 100;
    return `${mid} (±${f(spread / 2, 0)} %)`;
  };
  const lines = [
    `Kubernetes (OrbStack, 1 nodo de 10 CPUs). ${values.replicas} réplicas por variante, ` +
      `cada una con límite de 500m de CPU y 512 MiB. k6 como Job en el cluster contra el Service: ` +
      `${values.vus} VUs, ${values.duration} (+${values.warmup} de calentamiento). ` +
      `Repeticiones: ${runs}${runs > 1 ? " (mediana, y entre paréntesis la mitad del rango)" : ""}.`,
    "",
    "RAM: memoria privada (`anon`) de los pods. CPU: 100 % = 1 CPU. Redis: `INFO memory`.",
    "",
    "| Escenario | Variante | req/s | p50 (ms) | p95 (ms) | p99 (ms) | Errores | RAM total máx (MiB) | RAM por pod máx (MiB) | CPU total prom (%) | CPU por pod (mín–máx) | Datos Redis (MiB) | Claves |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|---|",
  ];
  const groups = new Map<string, Result[]>();
  for (const r of results) {
    const key = `${r.scenario}|${r.variant}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  for (const own of groups.values()) {
    const r = own[0];
    const pick = (fn: (x: Result) => number) => own.map(fn);
    lines.push(
      `| ${r.scenario} | ${r.variant} | ${summarize(pick((x) => x.requestsPerSecond))} | ` +
        `${f(median(pick((x) => x.latencyMs.med)))} | ${summarize(pick((x) => x.latencyMs.p95))} | ` +
        `${summarize(pick((x) => x.latencyMs.p99))} | ` +
        `${f(Math.max(...pick((x) => x.failedRate)) * 100, 2)} % | ` +
        `${f(median(pick((x) => x.memoryTotalMiB.max)), 0)} | ` +
        `${f(median(pick((x) => x.memoryPodMiB.max)), 0)} | ` +
        `${f(median(pick((x) => x.cpuTotalPercent.avg)), 0)} | ` +
        `${f(median(pick((x) => x.cpuPodPercent.min)), 0)}–${f(median(pick((x) => x.cpuPodPercent.max)), 0)} | ` +
        `${f(median(pick((x) => x.redisDataPeakMiB)))} | ` +
        `${f(median(pick((x) => x.redisKeys)), 0)} |`,
    );
  }
  lines.push(
    "",
    "| Variante | RAM en reposo por pod, mediana (MiB) |",
    "|---|---|",
  );
  for (const variant of new Set(results.map((r) => r.variant))) {
    lines.push(
      `| ${variant} | ${summarize(
        results.filter((r) => r.variant === variant).map((r) => r.idlePodMiB),
        0,
      )} |`,
    );
  }
  return lines.join("\n");
}

// The k6 script reaches the Jobs as a ConfigMap.
const configMap = await sh([
  "kubectl",
  "-n",
  NAMESPACE,
  "create",
  "configmap",
  "k6-script",
  `--from-file=script.js=${join(loadtestDir, "k6", "script.js")}`,
  "--dry-run=client",
  "-o",
  "yaml",
]);
await sh(["kubectl", "apply", "-f", "-"], { input: configMap });

const results: Result[] = [];
const scenarios = values.scenarios!.split(",");
const variants = values.variants!.split(",");
try {
  for (let repetition = 1; repetition <= Number(values.repeat); repetition++) {
    for (const scenario of scenarios) {
      for (const variant of variants) {
        process.stdout.write(`[${repetition}] ${scenario} · ${variant} … `);
        const result = await runOne(variant, scenario, repetition);
        console.log(
          `${result.requestsPerSecond.toFixed(1)} req/s, p95 ${result.latencyMs.p95.toFixed(1)} ms, ` +
            `RAM total máx ${result.memoryTotalMiB.max.toFixed(0)} MiB`,
        );
        results.push(result);
      }
    }
  }
} finally {
  // Leave the environment as Tilt deployed it.
  for (const variant of allVariants) {
    await kubectl(
      "scale",
      `deploy/${variant}`,
      `--replicas=${values.replicas}`,
    );
  }
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = join(loadtestDir, "results");
mkdirSync(outDir, { recursive: true });
writeFileSync(
  join(outDir, `k8s-${stamp}.json`),
  JSON.stringify({ config: values, results }, null, 2),
);
writeFileSync(join(outDir, `k8s-${stamp}.md`), report(results) + "\n");
console.log(
  `\n${report(results)}\n\nResultados en loadtest/results/k8s-${stamp}.{json,md}`,
);
