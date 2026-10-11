import type { Metadata } from "next";
import Link from "next/link";
import { Box, PageHeader } from "../components/page-header";

export const metadata: Metadata = { title: "Proxy" };

const links = [
  ["/proxy/redirect", "el proxy redirige a /static (307)"],
  ["/proxy/rewrite", "el proxy reescribe a /static"],
  ["/proxy/json", "el proxy responde JSON sin llegar a una ruta"],
] as const;

export default function Page() {
  return (
    <>
      <PageHeader
        title="Proxy (middleware)"
        adapter="Carga del proxy desde outputs.middleware y su traza."
      >
        <code>proxy.ts</code> agrega <code>x-proxy: 1</code> a todas las
        respuestas de páginas. Esta misma página debería traerlo.
      </PageHeader>
      <Box title="Casos">
        <ul className="flex flex-col gap-1">
          {links.map(([href, label]) => (
            <li key={href}>
              <Link href={href} prefetch={false} className="underline">
                {href}
              </Link>{" "}
              — {label}
            </li>
          ))}
        </ul>
      </Box>
    </>
  );
}
