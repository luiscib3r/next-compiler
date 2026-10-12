// OpenTelemetry. Next.js already instruments itself (a span per request,
// per route render, per fetch); this registers the SDK that exports those
// spans over OTLP/HTTP (e.g. OTEL_EXPORTER_OTLP_ENDPOINT=http://jaeger:4318).
//
// Only when `OTEL_EXPORTER_OTLP_ENDPOINT` is set, as with `REDIS_URI`:
// without a collector there is nothing to export to, and the exporter would
// log a failure on every batch.
//
// Not gRPC: it works (also inside the Bun binary), but its transport calls
// `Date.now()` on every export, and an export can run inside the async
// context of an ISR background revalidation. With Cache Components, Next
// takes it as the page reading an unstable value and aborts the
// revalidation, so ISR pages silently stop refreshing. The same happens on
// Node.js. The HTTP exporter does not trigger it.
export async function register() {
  if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT) return;
  const { registerOTel } = await import("@vercel/otel");
  registerOTel({
    serviceName: process.env.OTEL_SERVICE_NAME ?? "next-compiler",
    instrumentationConfig: {
      // next/og loads its WASM with a `fetch` of a `data:` URL, and the span
      // name would carry the whole module in base64 (tens of KB per span).
      fetch: { ignoreUrls: [/^data:/] },
    },
  });
}
