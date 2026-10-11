import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { Box, PageHeader } from "../components/page-header";

export const metadata: Metadata = { title: "Variables de entorno" };

async function RuntimeEnv() {
  await connection();
  return (
    <ul>
      <li>TEST_RUNTIME_ENV: {process.env.TEST_RUNTIME_ENV ?? "(no definida)"}</li>
      <li>NODE_ENV: {process.env.NODE_ENV}</li>
      <li>PORT: {process.env.PORT ?? "(no definida)"}</li>
    </ul>
  );
}

export default function Page() {
  return (
    <>
      <PageHeader
        title="Variables de entorno"
        adapter="El binario recibe el entorno del contenedor."
      >
        Corre el binario con <code>TEST_RUNTIME_ENV=hola ./server</code> y el
        valor debería aparecer aquí sin recompilar.
      </PageHeader>
      <Box title="process.env en runtime">
        <Suspense fallback={<p>cargando…</p>}>
          <RuntimeEnv />
        </Suspense>
      </Box>
    </>
  );
}
