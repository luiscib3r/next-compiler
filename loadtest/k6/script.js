// One k6 run per scenario. `loadtest/run.ts` starts the server, runs this
// script and collects the results.
//
//   k6 run -e BASE_URL=http://localhost:8080 -e SCENARIO=static script.js
//
// Closed model: VUS virtual users send requests back to back for DURATION,
// so the result shows the maximum throughput and the latency at saturation.

import http from "k6/http";
import { check } from "k6";

const BASE_URL = __ENV.BASE_URL ?? "http://localhost:8080";
const SCENARIO = __ENV.SCENARIO ?? "static";
const SUMMARY = __ENV.SUMMARY;

export const options = {
  vus: Number(__ENV.VUS ?? 32),
  duration: __ENV.DURATION ?? "30s",
  // Measure every response, including redirects, as the server sent it.
  maxRedirects: 0,
  discardResponseBodies: false,
  summaryTrendStats: ["avg", "min", "med", "p(90)", "p(95)", "p(99)", "max"],
};

// Allowed by Next's default `images.imageSizes`.
const IMAGE_WIDTHS = [32, 48, 64, 96, 128];

const scenarios = {
  // Prerendered HTML: the server returns a cached page.
  static: () => http.get(`${BASE_URL}/static`),
  // Server-side rendering on every request: headers(), cookies(), searchParams.
  dynamic: () =>
    http.get(`${BASE_URL}/dynamic?nombre=k6-${__ITER}`, {
      headers: { cookie: "tema=oscuro", "user-agent": "k6" },
    }),
  // Partial prerender with a `"use cache"` function (cacheLife "seconds").
  cache: () => http.get(`${BASE_URL}/cache`),
  // Dynamic route handler: reads headers and schedules `after()`.
  api: () => http.get(`${BASE_URL}/api/time`),
  // A static file from `.next/static`.
  asset: (data) => http.get(`${BASE_URL}${data.assetPath}`),
  // ISR: every request asks for a slug that was not prerendered, so the
  // server renders it and stores it in the incremental cache.
  "isr-new": () =>
    http.get(`${BASE_URL}/isr/k6-${__VU}-${__ITER}-${Date.now()}`),
  // Image optimization with sharp: a few variants of the same image.
  image: () =>
    http.get(
      `${BASE_URL}/_next/image?url=%2Ftest.png&w=${IMAGE_WIDTHS[__ITER % IMAGE_WIDTHS.length]}&q=75`,
      { headers: { accept: "image/webp" } },
    ),
};

export function setup() {
  if (!scenarios[SCENARIO]) {
    throw new Error(`unknown scenario: ${SCENARIO}`);
  }
  // The CSS file name has a content hash; read it from a page.
  const page = http.get(`${BASE_URL}/static`);
  const assetPath = page.body.match(
    /href="(\/_next\/static\/[^"]+\.css)"/,
  )?.[1];
  if (SCENARIO === "asset" && !assetPath) {
    throw new Error("no CSS file found in /static");
  }
  return { assetPath };
}

// eslint-disable-next-line import/no-anonymous-default-export
export default function (data) {
  const response = scenarios[SCENARIO](data);
  check(response, {
    "status 200": (r) => r.status === 200,
    "non-empty body": (r) => (r.body?.length ?? 0) > 0,
  });
}

export function handleSummary(data) {
  const output = {
    stdout: `${SCENARIO}: ${data.metrics.http_reqs.values.rate.toFixed(1)} req/s\n`,
  };
  if (SUMMARY) output[SUMMARY] = JSON.stringify(data);
  return output;
}
