import type { Metadata } from "next";
import Link from "next/link";
import { Box, PageHeader } from "../components/page-header";

export const metadata: Metadata = { title: "Redirects y rewrites" };

const links = [
  ["/navigation/redirect", "redirect() en un Server Component → /static (307)"],
  ["/old-static", "redirects de next.config → /static (308)"],
  ["/rewrite-config", "rewrites de next.config → contenido de /static, URL intacta"],
  ["/static", "headers de next.config → x-config-header"],
] as const;

export default function Page() {
  return (
    <>
      <PageHeader
        title="Redirects y rewrites"
        adapter="routes-manifest dentro del binario."
      >
        Revisa los status y headers con <code>curl -i</code>.
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
