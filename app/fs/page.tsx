import type { Metadata } from "next";
import bundled from "@/data/bundled.json";
import { Box, PageHeader } from "../components/page-header";

export const metadata: Metadata = { title: "Archivos estáticos" };

export default function Page() {
  return (
    <>
      <PageHeader
        title="Archivos estáticos"
        adapter="Los datos importados quedan dentro del chunk del servidor, embebido en el binario."
      >
        Para cargar datos estáticos usa <code>import</code>. No uses{" "}
        <code>fs.readFile(join(process.cwd(), …))</code>: en el binario{" "}
        <code>process.cwd()</code> es el directorio del contenedor, no el FS
        embebido.
      </PageHeader>
      <Box title="import de un JSON">
        <p>{`import: ${bundled.source === "import" ? "ok" : "FALLÓ"}`}</p>
        <p>{bundled.message}</p>
      </Box>
    </>
  );
}
