import type { Metadata } from "next";
import { Box, PageHeader } from "../components/page-header";
import { Counter } from "./counter";

export const metadata: Metadata = { title: "Client Components" };

export default function Page() {
  return (
    <>
      <PageHeader
        title="Client Components"
        adapter="Hidratación: los chunks de cliente en .next/static."
      >
        Si los JS de <code>/_next/static</code> no se sirven bien, el botón no
        responde y “hidratado” se queda en “no”.
      </PageHeader>
      <Box title="Interactivo">
        <Counter />
      </Box>
    </>
  );
}
