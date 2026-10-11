import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { io } from "next/cache";
import { Suspense } from "react";
import { Box, PageHeader } from "../components/page-header";

export const metadata: Metadata = { title: "Runtime APIs" };

async function RequestInfo({
  searchParams,
}: {
  searchParams: PageProps<"/dynamic">["searchParams"];
}) {
  const [h, c, query] = await Promise.all([headers(), cookies(), searchParams]);
  await io();
  return (
    <ul className="flex flex-col gap-1">
      <li>user-agent: {h.get("user-agent")}</li>
      <li>cookie tema: {c.get("tema")?.value ?? "(sin cookie)"}</li>
      <li>searchParams.nombre: {String(query.nombre ?? "(vacío)")}</li>
      <li>renderizado: {new Date().toISOString()}</li>
    </ul>
  );
}

export default function Page(props: PageProps<"/dynamic">) {
  return (
    <>
      <PageHeader
        title="Runtime APIs"
        adapter="AsyncLocalStorage compartido entre el servidor empaquetado y los chunks en $bunfs."
      >
        headers(), cookies() y searchParams leídos en cada request, dentro de
        un Suspense.
      </PageHeader>
      <Box title="Datos de esta request">
        <Suspense fallback={<p>cargando…</p>}>
          <RequestInfo searchParams={props.searchParams} />
        </Suspense>
      </Box>
    </>
  );
}
