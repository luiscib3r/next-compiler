"use client";

import { useActionState } from "react";
import { greet, type GreetState } from "./actions";

const initial: GreetState = { message: "", count: 0 };

export function GreetForm() {
  const [state, action, pending] = useActionState(greet, initial);
  return (
    <form action={action} className="flex flex-col gap-3 font-sans">
      <input
        name="name"
        placeholder="Tu nombre"
        className="rounded border px-3 py-1"
      />
      <button
        disabled={pending}
        className="w-fit rounded bg-zinc-900 px-3 py-1 text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
      >
        {pending ? "Enviando…" : "Saludar"}
      </button>
      {state.message && (
        <p className="font-mono">
          {state.message} · envíos: {state.count}
        </p>
      )}
    </form>
  );
}
