import { connection } from "next/server";
import { Suspense } from "react";

async function Boom(): Promise<React.ReactNode> {
  await connection();
  throw new Error("Error de prueba lanzado en runtime");
}

export default function Page() {
  return (
    <Suspense fallback={<p>a punto de fallar…</p>}>
      <Boom />
    </Suspense>
  );
}
