import Link from "next/link";
import { groups } from "./lib/tests";

export default function Home() {
  return (
    <>
      <header className="mb-10 flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Adapter tests</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Cada página ejercita una parte de Next.js que el binario de Bun tiene
          que soportar. <code>bun run smoke</code> corre los mismos checks con
          curl contra un servidor levantado.
        </p>
      </header>
      {groups.map((group) => (
        <section key={group.name} className="mb-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">
            {group.name}
          </h2>
          <ul className="flex flex-col gap-2">
            {group.tests.map((test) => (
              <li key={test.path}>
                <Link
                  href={test.path}
                  prefetch={false}
                  className="block rounded-lg border border-zinc-200 p-4 hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-600"
                >
                  <div className="flex items-baseline justify-between gap-4">
                    <span className="font-medium">{test.title}</span>
                    <code className="text-xs text-zinc-500">{test.path}</code>
                  </div>
                  <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                    {test.description}
                  </p>
                  <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                    {test.adapter}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
