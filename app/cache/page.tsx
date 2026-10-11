import type { Metadata } from "next";
import { Suspense } from "react";
import { Box, PageHeader } from "../components/page-header";
import { getQuote } from "../lib/data";
import { revalidateQuote, updateQuote } from "./actions";

export const metadata: Metadata = { title: "use cache + tags" };

async function Quote() {
  const quote = await getQuote();
  return (
    <>
      <p>id: {quote.id}</p>
      <p>{`Generado: ${quote.generatedAt}`}</p>
    </>
  );
}

export default function Page() {
  return (
    <>
      <PageHeader
        title="use cache + tags"
        adapter="Caché incremental en memoria (isrFlushToDisk = false, FS de solo lectura)."
      >
        <code>getQuote()</code> usa <code>cacheLife(&quot;seconds&quot;)</code>{" "}
        y <code>cacheTag(&quot;quote&quot;)</code>. Recarga para ver cuándo
        cambia el id.
      </PageHeader>
      <Box title="Valor cacheado">
        <Suspense fallback={<p>cargando…</p>}>
          <Quote />
        </Suspense>
      </Box>
      <Box title="Revalidar">
        <div className="flex gap-3 font-sans">
          <form action={revalidateQuote}>
            <button className="rounded border px-3 py-1">
              revalidateTag (stale-while-revalidate)
            </button>
          </form>
          <form action={updateQuote}>
            <button className="rounded border px-3 py-1">
              updateTag (inmediato)
            </button>
          </form>
        </div>
      </Box>
    </>
  );
}
