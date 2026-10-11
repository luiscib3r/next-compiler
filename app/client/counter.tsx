"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useSyncExternalStore } from "react";

const subscribe = () => () => {};

export function Counter() {
  const [count, setCount] = useState(0);
  // `false` in the server HTML, `true` once React hydrates in the browser.
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const pathname = usePathname();

  return (
    <div className="flex flex-col gap-3">
      <p>hidratado: {hydrated ? "sí" : "no (JS no cargó)"}</p>
      <p>usePathname: {pathname}</p>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setCount((value) => value + 1)}
          className="rounded bg-zinc-900 px-3 py-1 text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          Contador: {count}
        </button>
      </div>
      <Link href="/static" className="underline">
        Navegación cliente a /static (usa el payload RSC)
      </Link>
    </div>
  );
}
