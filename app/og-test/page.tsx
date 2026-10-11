import type { Metadata } from "next";
import { Box, PageHeader } from "../components/page-header";

export const metadata: Metadata = { title: "Open Graph image" };

export default function Page() {
  return (
    <>
      <PageHeader
        title="Open Graph image"
        adapter="next/og carga WASM (resvg, yoga) y fuentes desde archivos."
      >
        La imagen la genera <code>opengraph-image.tsx</code> con{" "}
        <code>ImageResponse</code>.
      </PageHeader>
      <Box title="Imagen generada">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/og-test/opengraph-image" alt="OG generada" width={600} height={315} />
      </Box>
    </>
  );
}
