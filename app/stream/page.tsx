import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { Box, PageHeader } from "../components/page-header";
import { sleep } from "../lib/data";

export const metadata: Metadata = { title: "Streaming" };

async function Delayed({ ms, id }: { ms: number; id: string }) {
  await connection();
  await sleep(ms);
  return (
    // A single string, so React does not split it with `<!-- -->` markers.
    <p>{`${id}-listo después de ${ms}ms`}</p>
  );
}

export default function Page() {
  return (
    <>
      <PageHeader
        title="Streaming"
        adapter="Respuestas en chunks (Transfer-Encoding) desde el binario."
      >
        El shell llega de inmediato y cada bloque aparece cuando resuelve.
        Pruébalo con <code>curl -N</code>.
      </PageHeader>
      {(
        [
          ["rapido", 500],
          ["medio", 1000],
          ["lento", 2000],
        ] as const
      ).map(([id, ms]) => (
        <Box key={id} title={`${ms}ms`}>
          <Suspense fallback={<p>esperando {id}…</p>}>
            <Delayed id={id} ms={ms} />
          </Suspense>
        </Box>
      ))}
    </>
  );
}
