import type { Metadata } from "next";
import Image from "next/image";
import { Box, PageHeader } from "../components/page-header";

export const metadata: Metadata = { title: "next/image" };

export default function Page() {
  return (
    <>
      <PageHeader
        title="next/image"
        adapter="sharp es un módulo nativo (.node): dlopen desde el binario."
      >
        La imagen pasa por <code>/_next/image</code>, que la redimensiona con
        sharp.
      </PageHeader>
      <Box title="PNG local optimizado">
        <Image src="/test.png" alt="Degradado de prueba" width={128} height={128} />
      </Box>
    </>
  );
}
