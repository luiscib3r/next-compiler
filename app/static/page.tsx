import type { Metadata } from "next";
import { Box, PageHeader } from "../components/page-header";

export const metadata: Metadata = { title: "Página estática" };

export default function Page() {
  return (
    <>
      <PageHeader
        title="Página estática"
        adapter="Sirve HTML prerenderizado desde el FS embebido."
      >
        No lee nada de la request, así que Next la prerenderiza en el build.
      </PageHeader>
      <Box title="Cómo verificar">
        La respuesta trae <code>x-nextjs-cache: HIT</code> y{" "}
        <code>x-nextjs-prerender: 1</code>.
      </Box>
    </>
  );
}
