// Shared by the load test runners (`run.ts` for Docker, `k8s.ts` for
// Kubernetes): container metrics from the Docker API and small statistics.

export type Usage = { memoryMiB: number; cpuPercent: number };

// Memory and CPU come from the Docker API, not `docker stats`. `docker stats`
// counts the page cache of files the container read (the 124 MB binary,
// `node_modules`), and cgroups charge those pages to whichever container
// touched them first: the same image measured 45 or 135 MiB depending on
// what ran before. `anon` is the process's own memory (heap, stacks), which
// is what a replica costs.
const DOCKER_SOCKET = process.env.DOCKER_SOCKET ?? "/var/run/docker.sock";

type DockerStats = {
  memory_stats: { stats?: { anon?: number } };
  cpu_stats: {
    cpu_usage: { total_usage: number };
    system_cpu_usage?: number;
    online_cpus?: number;
  };
  precpu_stats: {
    cpu_usage: { total_usage: number };
    system_cpu_usage?: number;
  };
};

function toUsage(stats: DockerStats): Usage {
  const cpuDelta =
    stats.cpu_stats.cpu_usage.total_usage -
    stats.precpu_stats.cpu_usage.total_usage;
  const systemDelta =
    (stats.cpu_stats.system_cpu_usage ?? 0) -
    (stats.precpu_stats.system_cpu_usage ?? 0);
  const cpus = stats.cpu_stats.online_cpus ?? 1;
  return {
    memoryMiB: (stats.memory_stats.stats?.anon ?? 0) / 1024 / 1024,
    cpuPercent: systemDelta > 0 ? (cpuDelta / systemDelta) * cpus * 100 : 0,
  };
}

// One reading, without waiting for a second one: the memory is exact, the
// CPU is not (it needs two readings). Used for idle memory.
export async function usage(container: string): Promise<Usage> {
  const response = await fetch(
    `http://localhost/containers/${container}/stats?stream=false&one-shot=true`,
    { unix: DOCKER_SOCKET },
  );
  return toUsage((await response.json()) as DockerStats);
}

// Samples the container about once a second while k6 runs.
export function sampleUsage(container: string) {
  const samples: Usage[] = [];
  const controller = new AbortController();
  (async () => {
    const response = await fetch(
      `http://localhost/containers/${container}/stats?stream=true`,
      { unix: DOCKER_SOCKET, signal: controller.signal },
    );
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) samples.push(toUsage(JSON.parse(line) as DockerStats));
      }
    }
  })().catch(() => {});
  return {
    stop() {
      controller.abort();
      // The first sample has no previous CPU reading to compare with.
      return samples.slice(1);
    },
  };
}

export function median(numbers: number[]) {
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function stats(numbers: number[]) {
  if (!numbers.length) return { avg: 0, max: 0 };
  const sum = numbers.reduce((a, b) => a + b, 0);
  return { avg: sum / numbers.length, max: Math.max(...numbers) };
}
