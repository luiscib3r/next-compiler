import { Suspense } from "react";
import { Box, PageHeader } from "../../components/page-header";
import { getItem } from "../../lib/data";

export function generateStaticParams() {
  return [{ slug: "a" }, { slug: "b" }];
}

export async function generateMetadata(props: PageProps<"/isr/[slug]">) {
  const { slug } = await props.params;
  return { title: `ISR ${slug}` };
}

async function Item({ params }: Pick<PageProps<"/isr/[slug]">, "params">) {
  const { slug } = await params;
  const item = await getItem(slug);
  return (
    <>
      <p>{`slug: ${item.slug}`}</p>
      <p>generado: {item.generatedAt}</p>
    </>
  );
}

export default function Page(props: PageProps<"/isr/[slug]">) {
  return (
    <>
      <PageHeader
        title="ISR con generateStaticParams"
        adapter="Escrituras al caché ISR en runtime sin disco."
      >
        /isr/a y /isr/b se prerenderizan. Cualquier otro slug sirve el App
        Shell, se renderiza en runtime y se guarda para la siguiente visita.
      </PageHeader>
      <Box title="Item">
        <Suspense fallback={<p>cargando item…</p>}>
          <Item params={props.params} />
        </Suspense>
      </Box>
    </>
  );
}
