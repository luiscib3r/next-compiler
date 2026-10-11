import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Suspense } from "react";
import { Box, PageHeader } from "../components/page-header";
import { goToStatic } from "./actions";
import { GreetForm } from "./greet-form";

export const metadata: Metadata = { title: "Server Actions" };

async function LastGreeting() {
  const value = (await cookies()).get("ultimo-saludo")?.value;
  return <p>cookie ultimo-saludo: {value ?? "(sin cookie)"}</p>;
}

export default function Page() {
  return (
    <>
      <PageHeader
        title="Server Actions"
        adapter="server-reference-manifest y el endpoint de acciones (POST con Next-Action)."
      >
        La acción guarda una cookie y devuelve estado nuevo. Recarga para ver
        la cookie leída en el servidor.
      </PageHeader>
      <Box title="useActionState">
        <GreetForm />
      </Box>
      <Box title="Cookie escrita por la acción">
        <Suspense fallback={<p>cargando…</p>}>
          <LastGreeting />
        </Suspense>
      </Box>
      <Box title="redirect() desde una acción">
        <form action={goToStatic}>
          <button className="rounded border px-3 py-1 font-sans">
            Ir a /static
          </button>
        </form>
      </Box>
    </>
  );
}
