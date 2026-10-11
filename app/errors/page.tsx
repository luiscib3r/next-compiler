import type { Metadata } from "next";
import Link from "next/link";
import { Box, PageHeader } from "../components/page-header";

export const metadata: Metadata = { title: "Errores" };

const links = [
  ["/errors/boom", "lanza un error en runtime → error.tsx"],
  ["/errors/missing", "llama notFound() → not-found.tsx (404)"],
  ["/no-existe", "ruta inexistente → not-found.tsx (404)"],
] as const;

export default function Page() {
  return (
    <>
      <PageHeader
        title="Errores"
        adapter="Páginas de error y _not-found desde el FS embebido."
      />
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
